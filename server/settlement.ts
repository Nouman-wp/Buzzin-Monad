import { economy } from '@/lib/config';
import { getStore } from '@/lib/store';
import { emitEvent, emitEvents } from '@/server/events';
import { buildSettlementPlan, validateSettlementPlan } from '@/lib/engine/settlement';
import { applyRanks } from '@/lib/engine/leaderboard';
import { formatMon } from '@/lib/util/money';
import { RoomError, syncReservation } from '@/server/rooms';
import {
  claimFor as chainClaimFor,
  createAndFundGame,
  finalizeGame as chainFinalize,
  isAddress,
} from '@/lib/chain/settlement';
import { isChainSettlementEnabled, readGame } from '@/lib/chain/client';
import { explorerTxUrl } from '@/lib/chain/monad';
import type { RoomState, Settlement, SettlementItem } from '@/lib/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Settlement.
 *
 * Off-chain accounting is authoritative during play; the chain is touched once,
 * at the end, with a payload this module derives deterministically from frozen
 * game state. Nothing a client sends is used in the calculation.
 *
 * The pipeline is: prepare (compute + validate) -> submit (escrow + finalise on
 * chain) -> claim (per player, pull-based, idempotent).
 */

/** Total wei locked for a room: one full allocation per player who joined. */
export function lockedTotalWei(room: RoomState): bigint {
  return economy.playerAllocationWei * BigInt(Object.keys(room.players).length);
}

/**
 * Compute and store the settlement plan. Pure with respect to the chain — it
 * can be run repeatedly and always produces the same answer for a given game.
 */
export async function prepareSettlement(roomId: string): Promise<RoomState> {
  const store = getStore();
  const room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  if (room.status !== 'FINALIZING' && room.status !== 'COMPLETED') {
    throw new RoomError('The game has not finished yet', 409, 'NOT_FINISHED');
  }
  if (room.settlement.status === 'CONFIRMED' || room.settlement.status === 'OFF_CHAIN') {
    return room;
  }

  const ranked = applyRanks(room.players);
  const plan = buildSettlementPlan(ranked, BigInt(room.prizePoolWei));

  const check = validateSettlementPlan(plan, lockedTotalWei(room));
  if (!check.ok) {
    // A failed invariant must never reach the chain.
    const failed = await store.updateRoom(roomId, (state) => {
      state.settlement = {
        ...state.settlement,
        status: 'FAILED',
        error: check.reason,
        preparedAt: Date.now(),
      };
      return state;
    });
    await emitEvent(roomId, {
      type: 'SETTLEMENT_FAILED',
      level: 'ERROR',
      message: `Settlement rejected: ${check.reason}`,
      payload: { reason: check.reason },
    });
    return failed ?? room;
  }

  const settlement: Settlement = {
    status: 'PREPARED',
    prizePoolWei: plan.prizePoolWei.toString(),
    totalPrizeAllocatedWei: plan.totalPrizeAllocatedWei.toString(),
    totalRefundWei: plan.totalRefundWei.toString(),
    totalAllocatedWei: plan.totalAllocatedWei.toString(),
    items: plan.items,
    txHash: null,
    error: null,
    preparedAt: Date.now(),
    finalizedAt: null,
  };

  const updated = await store.updateRoom(roomId, (state) => {
    if (state.settlement.status === 'CONFIRMED') return null;
    state.players = ranked;
    state.settlement = settlement;
    return state;
  });
  if (!updated) return room;

  await emitEvent(
    roomId,
    {
      type: 'SETTLEMENT_STARTED',
      level: 'CHAIN',
      message: 'Settlement payload prepared',
      payload: {
        prizePool: `${formatMon(settlement.prizePoolWei)} MON`,
        winners: settlement.items.filter((item) => BigInt(item.prizeWei) > 0n).length,
        refunds: `${formatMon(settlement.totalRefundWei)} MON`,
        total: `${formatMon(settlement.totalAllocatedWei)} MON`,
      },
    },
    { version: updated.version },
  );

  return updated;
}

/**
 * Push the prepared plan on chain: escrow the exact payout total, then freeze
 * the payout table. When the chain is not configured the settlement is marked
 * OFF_CHAIN — a fully supported mode in which every number is still final and
 * auditable, just not yet notarised.
 */
export async function submitSettlement(roomId: string): Promise<RoomState> {
  const store = getStore();
  let room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');

  if (room.settlement.status === 'NOT_STARTED' || room.settlement.status === 'FAILED') {
    room = await prepareSettlement(roomId);
  }
  if (room.settlement.status === 'CONFIRMED') return room;
  if (room.settlement.status === 'FAILED') return room;

  if (!isChainSettlementEnabled()) {
    const offChain = await markComplete(roomId, (settlement) => ({
      ...settlement,
      status: 'OFF_CHAIN',
      finalizedAt: Date.now(),
      error: null,
    }));
    await emitEvent(roomId, {
      type: 'SETTLEMENT_CONFIRMED',
      level: 'WARN',
      message: 'Settled off-chain — no treasury key or contract configured',
      payload: { total: `${formatMon(room.settlement.totalAllocatedWei)} MON`, mode: 'off-chain' },
    });
    return offChain ?? room;
  }

  const marked = await store.updateRoom(roomId, (state) => {
    if (state.settlement.status === 'SUBMITTING' || state.settlement.status === 'CONFIRMED') {
      return null;
    }
    state.settlement = { ...state.settlement, status: 'SUBMITTING', error: null };
    return state;
  });
  // Another request is already submitting; do not send a second transaction.
  if (!marked) return (await store.getRoomById(roomId)) ?? room;

  const payoutTotal = BigInt(marked.settlement.totalAllocatedWei);

  // Escrow first: the contract refuses any payout table it cannot cover, so
  // funding before finalising is what makes a claim guaranteed to succeed.
  const existing = await readGame(roomId);
  if (!existing?.exists) {
    const funded = await createAndFundGame(roomId, marked.config.maxPlayers, payoutTotal);
    if (!funded.ok) return failSettlement(roomId, funded.error ?? 'Escrow funding failed');
    await emitEvent(roomId, {
      type: 'SETTLEMENT_STARTED',
      level: 'CHAIN',
      message: `Escrow funded with ${formatMon(payoutTotal)} MON`,
      payload: { tx: funded.txHash, amount: `${formatMon(payoutTotal)} MON` },
    });
  }

  const finalised = await chainFinalize(roomId, marked.settlement.items);
  if (!finalised.ok) return failSettlement(roomId, finalised.error ?? 'Finalisation failed');

  const completed = await markComplete(roomId, (settlement) => ({
    ...settlement,
    status: 'CONFIRMED',
    txHash: finalised.txHash,
    error: null,
    finalizedAt: Date.now(),
  }));

  await emitEvents(roomId, [
    {
      type: 'SETTLEMENT_CONFIRMED',
      level: 'CHAIN',
      message: 'Settlement confirmed on Monad',
      payload: {
        tx: finalised.txHash,
        total: `${formatMon(payoutTotal)} MON`,
        explorer: finalised.txHash ? explorerTxUrl(finalised.txHash) : null,
      },
    },
    {
      type: 'GAME_COMPLETED',
      level: 'SUCCESS',
      message: 'Game complete — cash-out is open',
      payload: { room: marked.code },
    },
  ]);

  return completed ?? marked;
}

async function failSettlement(roomId: string, reason: string): Promise<RoomState> {
  const updated = await getStore().updateRoom(roomId, (state) => {
    state.settlement = { ...state.settlement, status: 'FAILED', error: reason };
    return state;
  });
  await emitEvent(roomId, {
    type: 'SETTLEMENT_FAILED',
    level: 'ERROR',
    message: `Settlement failed: ${reason}`,
    payload: { reason },
  });
  if (!updated) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  return updated;
}

async function markComplete(
  roomId: string,
  update: (settlement: Settlement) => Settlement,
): Promise<RoomState | null> {
  return getStore().updateRoom(roomId, (state) => {
    state.settlement = update(state.settlement);
    state.status = 'COMPLETED';
    state.phase = 'COMPLETED';
    if (state.endedAt === null) state.endedAt = Date.now();
    syncReservation(state);
    return state;
  });
}

// -------------------------------------------------------------------- claim

export interface ClaimResult {
  item: SettlementItem;
  txHash: string | null;
  explorerUrl: string | null;
  onChain: boolean;
}

/**
 * Cash out.
 *
 * Only allowed after the game is complete. The payout amount comes from the
 * frozen settlement, never from the request. A second claim is rejected both
 * here and, independently, by the contract.
 */
export async function claimPayout(
  roomId: string,
  user: SessionUser,
  destination?: string,
): Promise<ClaimResult> {
  const store = getStore();
  const room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');

  if (room.status !== 'COMPLETED') {
    throw new RoomError('Cash-out opens when the game is complete', 409, 'GAME_ACTIVE');
  }
  const status = room.settlement.status;
  if (status !== 'CONFIRMED' && status !== 'OFF_CHAIN') {
    throw new RoomError('Settlement has not been finalised yet', 409, 'NOT_SETTLED');
  }

  const item = room.settlement.items.find((entry) => entry.playerId === user.id);
  if (!item) throw new RoomError('You have nothing to claim in this game', 404, 'NO_PAYOUT');
  if (item.claimed) throw new RoomError('You have already cashed out', 409, 'ALREADY_CLAIMED');
  if (BigInt(item.totalPayoutWei) <= 0n) {
    throw new RoomError('Your payout for this game is zero', 409, 'ZERO_PAYOUT');
  }

  const target = (destination ?? user.walletAddress ?? '').trim();
  if (!isAddress(target)) {
    throw new RoomError('Enter a valid destination address', 400, 'BAD_DESTINATION');
  }

  // Reserve the claim before touching the chain, so a retry after a timeout
  // cannot pay twice.
  const reserved = await store.updateRoom(roomId, (state) => {
    const entry = state.settlement.items.find((candidate) => candidate.playerId === user.id);
    if (!entry || entry.claimed) return null;
    entry.claimed = true;
    entry.claimedTo = target;
    return state;
  });
  if (!reserved) throw new RoomError('You have already cashed out', 409, 'ALREADY_CLAIMED');

  if (status === 'OFF_CHAIN' || !isChainSettlementEnabled()) {
    await emitEvent(roomId, {
      type: 'CLAIM_SUBMITTED',
      level: 'WARN',
      message: `${user.displayName} cashed out ${formatMon(item.totalPayoutWei)} MON (off-chain)`,
      payload: { player: user.displayName, amount: `${formatMon(item.totalPayoutWei)} MON`, mode: 'off-chain' },
    });
    return {
      item: { ...item, claimed: true, claimedTo: target },
      txHash: null,
      explorerUrl: null,
      onChain: false,
    };
  }

  // The player's embedded wallet holds no gas, so the operator submits the
  // claim on their behalf. Funds go to the player's destination, never to the
  // operator, and the contract enforces that.
  const result = await chainClaimFor(roomId, item.walletAddress, target);

  if (!result.ok) {
    // Release the reservation so the player can retry.
    await store.updateRoom(roomId, (state) => {
      const entry = state.settlement.items.find((candidate) => candidate.playerId === user.id);
      if (!entry) return null;
      entry.claimed = false;
      entry.claimedTo = null;
      return state;
    });
    await emitEvent(roomId, {
      type: 'SETTLEMENT_FAILED',
      level: 'ERROR',
      message: `Cash-out failed for ${user.displayName}: ${result.error}`,
      payload: { player: user.displayName, reason: result.error },
    });
    throw new RoomError(result.error ?? 'Cash-out failed. Try again.', 502, 'CLAIM_FAILED');
  }

  const finalised = await store.updateRoom(roomId, (state) => {
    const entry = state.settlement.items.find((candidate) => candidate.playerId === user.id);
    if (!entry) return null;
    entry.claimTxHash = result.txHash;
    return state;
  });

  await emitEvent(
    roomId,
    {
      type: 'CLAIM_SUBMITTED',
      level: 'CHAIN',
      message: `${user.displayName} cashed out ${formatMon(item.totalPayoutWei)} MON`,
      payload: {
        player: user.displayName,
        amount: `${formatMon(item.totalPayoutWei)} MON`,
        to: target,
        tx: result.txHash,
      },
    },
    { version: finalised?.version },
  );

  return {
    item: { ...item, claimed: true, claimedTo: target, claimTxHash: result.txHash },
    txHash: result.txHash,
    explorerUrl: result.txHash ? explorerTxUrl(result.txHash) : null,
    onChain: true,
  };
}
