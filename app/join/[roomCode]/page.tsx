import { JoinFlow } from '@/components/player/join-flow';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return { title: `Join ${roomCode.toUpperCase()}` };
}

/**
 * The QR landing page.
 *
 * A scan lands here directly — no homepage detour — and the whole path from
 * cold open to lobby is: see the room, sign in, confirm your name, in.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return <JoinFlow roomCode={roomCode.toUpperCase()} />;
}
