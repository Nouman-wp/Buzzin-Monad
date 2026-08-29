import { AdminOverview } from '@/components/admin/overview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

export default function AdminPage() {
  return <AdminOverview />;
}
