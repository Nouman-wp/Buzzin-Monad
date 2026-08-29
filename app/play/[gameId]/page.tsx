import { GameScreen } from '@/components/player/game-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Playing' };

export default async function PlayPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameScreen gameId={gameId} />;
}
