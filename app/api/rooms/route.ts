import { getStore } from '@/lib/store';
import { createRoomSchema } from '@/lib/validation';
import { createRoom, readTreasury } from '@/server/rooms';
import { joinUrlFor } from '@/server/snapshots';
import { handle, ok, parseBody, requireUser } from '@/server/http';
import { economy } from '@/lib/config';
import { getCachedBalance, getTreasuryAddress } from '@/lib/chain/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Rooms owned by the signed-in host, plus current treasury headroom. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const [rooms, treasury] = await Promise.all([
      getStore().listRoomsByHost(user.id),
      readTreasury(),
    ]);
    // The wallet balance is shown next to the budget because the two are
    // different numbers and confusing them is the obvious failure mode.
    const treasuryAddress = getTreasuryAddress();
    const onChainBalance = treasuryAddress ? await getCachedBalance(treasuryAddress) : null;
    return ok({
      rooms: rooms.map((room) => ({
        id: room.id,
        code: room.code,
        name: room.config.name,
        mode: room.config.mode,
        status: room.status,
        players: Object.keys(room.players).length,
        maxPlayers: room.config.maxPlayers,
        prizePoolWei: room.prizePoolWei,
        createdAt: room.createdAt,
        joinUrl: joinUrlFor(room),
      })),
      treasury: {
        totalWei: treasury.totalWei.toString(),
        reservedWei: treasury.reservedWei.toString(),
        availableWei: treasury.availableWei.toString(),
        maxFundablePlayers: Number(treasury.availableWei / economy.playerAllocationWei),
        onChainBalanceWei: onChainBalance === null ? null : onChainBalance.toString(),
        address: treasuryAddress,
      },
    });
  });
}

/** Create a room. Any signed-in user can become a host. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const input = await parseBody(request, createRoomSchema);
    const room = await createRoom(user, input);
    return ok({ room, joinUrl: joinUrlFor(room) }, { status: 201 });
  });
}
