import { AppShell } from '@/app/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { ConnectedSidebar } from './ConnectedSidebar';
import { useMeta } from './metaStore';

export default function HomePage() {
  const meta = useMeta();
  const noProviders = meta != null && meta.providers.length === 0;

  return (
    <AppShell sidebar={<ConnectedSidebar />}>
      <EmptyState />
      {noProviders ? (
        <p
          data-testid="no-providers-hint"
          className="mx-auto mt-6 max-w-[640px] text-[12.5px] leading-relaxed text-muted"
        >
          No providers configured. Put{' '}
          <code className="kbd mx-0.5 h-auto px-1 py-0.5">OPENAI_API_KEY</code> or{' '}
          <code className="kbd mx-0.5 h-auto px-1 py-0.5">OPENROUTER_API_KEY</code> in{' '}
          <code className="kbd mx-0.5 h-auto px-1 py-0.5">agent-xray/.env</code> and restart the
          server.
        </p>
      ) : null}
    </AppShell>
  );
}
