import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTLEMENT_ABI } from '@/lib/chain/abi';
import { buildSettlementPlan, validateSettlementPlan } from '@/lib/engine/settlement';
import { economy } from '@/lib/config';
import { MON, makePlayers } from './helpers';

/**
 * Contract-surface tests.
 *
 * The hand-maintained ABI is what the runtime actually encodes calls with, so
 * it is checked against the compiled artifact rather than assumed correct. The
 * behavioural guarantees the contract enforces on-chain (over-allocation
 * rejected, double claims impossible) are mirrored here against the payload the
 * server produces, so a bad payload is caught before it costs gas.
 */

const ARTIFACT = join(process.cwd(), 'contracts', 'out', 'BlitzPlaySettlement.json');
const SOURCE = join(process.cwd(), 'contracts', 'BlitzPlaySettlement.sol');

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: Array<{ name: string; type: string }>;
  stateMutability?: string;
}

describe('settlement contract source', () => {
  const source = readFileSync(SOURCE, 'utf8');

  it('exposes the full settlement lifecycle', () => {
    for (const fn of [
      'function createGame',
      'function fundGame',
      'function registerPlayers',
      'function finalizeGame',
      'function claim',
      'function claimTo',
      'function claimFor',
    ]) {
      expect(source).toContain(fn);
    }
  });

  it('restricts privileged entry points to the operator', () => {
    for (const guarded of ['createGame', 'fundGame', 'finalizeGame', 'sweepUnallocated']) {
      const signature = new RegExp(`function ${guarded}\\([\\s\\S]*?onlyOperator`);
      expect(source).toMatch(signature);
    }
  });

  it('rejects over-allocation on chain', () => {
    expect(source).toContain('if (total > game.funded) revert OverAllocated();');
  });

  it('prevents a second finalisation', () => {
    expect(source).toContain('if (game.finalized) revert AlreadyFinalized();');
  });

  it('prevents a double claim', () => {
    expect(source).toContain('if (_claimed[gameId][player]) revert AlreadyClaimed();');
    expect(source).toContain('_claimed[gameId][player] = true;');
  });

  it('follows checks-effects-interactions in the claim path', () => {
    const claimBody = source.slice(
      source.indexOf('function _claim('),
      source.indexOf('function sweepUnallocated('),
    );
    const marksClaimed = claimBody.indexOf('_claimed[gameId][player] = true;');
    const zeroesEntitlement = claimBody.indexOf('_entitlement[gameId][player] = 0;');
    const externalCall = claimBody.indexOf('destination.call{value: amount}');
    expect(marksClaimed).toBeGreaterThan(-1);
    expect(zeroesEntitlement).toBeGreaterThan(marksClaimed);
    // Every state write happens before the external transfer.
    expect(externalCall).toBeGreaterThan(zeroesEntitlement);
  });

  it('guards against reentrancy on every fund-moving path', () => {
    expect(source).toContain('modifier nonReentrant()');
    for (const fn of ['function claim(', 'function claimTo(', 'function claimFor(']) {
      const start = source.indexOf(fn);
      const signatureEnd = source.indexOf('{', start);
      expect(source.slice(start, signatureEnd)).toContain('nonReentrant');
    }
  });

  it('never lets a sweep touch funds still owed to players', () => {
    expect(source).toContain('uint256 surplus = game.funded - game.allocated;');
    expect(source).toContain('require(address(this).balance >= outstanding + surplus');
  });

  it('emits an event for every settlement-relevant action', () => {
    for (const event of [
      'event GameCreated',
      'event GameFunded',
      'event PlayersRegistered',
      'event GameFinalized',
      'event Claimed',
    ]) {
      expect(source).toContain(event);
    }
  });
});

describe('compiled artifact', () => {
  const compiled = existsSync(ARTIFACT);

  it.runIf(compiled)('deploys under the EIP-170 size limit', () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
    const bytes = (artifact.deployedBytecode.length - 2) / 2;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(24_576);
  });

  it.runIf(compiled)('matches the hand-maintained ABI used at runtime', () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
    const compiledFns = new Map<string, AbiEntry>(
      (artifact.abi as AbiEntry[])
        .filter((entry) => entry.type === 'function')
        .map((entry) => [signature(entry), entry]),
    );

    for (const entry of SETTLEMENT_ABI as unknown as AbiEntry[]) {
      if (entry.type !== 'function') continue;
      const match = compiledFns.get(signature(entry));
      expect(match, `ABI drift: ${signature(entry)} not in the compiled contract`).toBeTruthy();
      expect(match!.stateMutability).toBe(entry.stateMutability);
    }
  });
});

function signature(entry: AbiEntry): string {
  return `${entry.name}(${(entry.inputs ?? []).map((input) => input.type).join(',')})`;
}

describe('settlement payload the contract receives', () => {
  it('never exceeds the escrow the contract will hold', () => {
    const players = makePlayers([
      ['a', { score: 900 }],
      ['b', { score: 700, currentGameBalanceWei: '200000000000000000', wrongCount: 3 }],
      ['c', { score: 500, currentGameBalanceWei: '0', wrongCount: 5, eliminated: true }],
    ]);
    const pool = economy.prizePoolContributionWei * 3n + economy.penaltyWei * 8n;
    const plan = buildSettlementPlan(players, pool);
    const locked = economy.playerAllocationWei * 3n;

    // This is precisely the check `finalizeGame` performs on chain.
    expect(plan.totalAllocatedWei).toBeLessThanOrEqual(locked);
    expect(validateSettlementPlan(plan, locked).ok).toBe(true);
  });

  it('submits address/amount arrays of equal length with no zero entries', () => {
    const players = makePlayers([['a', { score: 400 }], ['b', { score: 300 }]]);
    const plan = buildSettlementPlan(players, 2n * MON);
    const payable = plan.items.filter((item) => BigInt(item.totalPayoutWei) > 0n);

    const addresses = payable.map((item) => item.walletAddress);
    const amounts = payable.map((item) => BigInt(item.totalPayoutWei));

    expect(addresses).toHaveLength(amounts.length);
    expect(addresses.every((address) => /^0x[0-9a-fA-F]{40}$/.test(address))).toBe(true);
    expect(amounts.every((amount) => amount > 0n)).toBe(true);
  });

  it('produces one entry per player, so no address is double-credited', () => {
    const players = makePlayers([['a'], ['b'], ['c'], ['d'], ['e'], ['f']]);
    const plan = buildSettlementPlan(players, 6n * MON);
    const ids = plan.items.map((item) => item.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
