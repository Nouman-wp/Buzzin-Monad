import { AccountDashboard } from '@/components/account/dashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return <AccountDashboard />;
}
