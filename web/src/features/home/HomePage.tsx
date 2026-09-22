import { AppShell } from '@/app/AppShell';
import { Sidebar } from '@/app/Sidebar';
import { EmptyState } from '@/components/EmptyState';

export default function HomePage() {
  return (
    <AppShell sidebar={<Sidebar />}>
      <EmptyState />
    </AppShell>
  );
}
