import { getStore } from '@/lib/store';
import { readTreasury } from '@/server/rooms';
import { getCachedBalance, getTreasuryAddress, isChainSettlementEnabled } from '@/lib/chain/client';
import { featureFlags } from '@/lib/config';
import { handle, ok, requireAdmin } from '@/server/http';
import { joinUrlFor } from '@/server/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Platform-wide metrics for the admin overview. */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const store = getStore();
    const [rooms, treasury] = await Promise.all([store.listRooms(50), readTreasury()]);

    const address = getTreasuryAddress();
    const onChainBalance = address ? await getCachedBalance(address) : null;

    const active = rooms.filter(
      (room) => room.status === 'LOBBY' || room.status === 'RUNNING' || room.status === 'PAUSED',
    );
    const playersOnline = active.reduce(
      (total, room) => total + Object.keys(room.players).length,
      0,
    );

    return ok({
      metrics: {
        roomsActive: active.length,
        roomsTotal: rooms.length,
        playersOnline,
        aiDecisions: rooms.reduce((total, room) => total + room.aiDecisions.length, 0),
        eliminations: rooms.reduce(
          (total, room) =>
            total + Object.values(room.players).filter((player) => player.eliminated).length,
          0,
        ),
        transactions: rooms.filter((room) => room.settlement.txHash).length,
        prizePoolWei: rooms
          .reduce((total, room) => total + BigInt(room.prizePoolWei), 0n)
          .toString(),
      },
      treasury: {
        totalWei: treasury.totalWei.toString(),
        reservedWei: treasury.reservedWei.toString(),
        availableWei: treasury.availableWei.toString(),
        address,
        onChainBalanceWei: onChainBalance === null ? null : onChainBalance.toString(),
      },
      capabilities: {
        aiEnabled: featureFlags.aiEnabled,
        chainEnabled: isChainSettlementEnabled(),
        durableStore: store.durable,
        storeName: store.name,
      },
      rooms: rooms.map((room) => ({
        id: room.id,
        code: room.code,
        name: room.config.name,
        mode: room.config.mode,
        status: room.status,
        phase: room.phase,
        hostName: room.hostName,
        players: Object.keys(room.players).length,
        maxPlayers: room.config.maxPlayers,
        currentRound: room.currentRound,
        totalRounds: room.config.questionCount,
        prizePoolWei: room.prizePoolWei,
        settlementStatus: room.settlement.status,
        txHash: room.settlement.txHash,
        createdAt: room.createdAt,
        joinUrl: joinUrlFor(room),
      })),
    });
  });
}
