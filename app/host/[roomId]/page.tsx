import { HostDashboard } from '@/components/host/dashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Host dashboard' };

export default async function HostRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <HostDashboard roomId={roomId} />;
}
