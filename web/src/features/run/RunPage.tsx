import { useParams } from 'react-router';
import { AppShell } from '@/app/AppShell';
import { Sidebar } from '@/app/Sidebar';
import { Panel } from '@/components/Panel';
import { Pill } from '@/components/Pill';

export default function RunPage() {
  const { id } = useParams();

  return (
    <AppShell sidebar={<Sidebar activeId={id ?? null} />}>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[16px] font-medium text-fg">run {id ?? '—'}</div>
          <p className="mt-1 text-[13px] text-muted">
            Run detail timeline and trace will render here.
          </p>
        </div>
        <Pill status="running" />
      </header>
      <Panel title="Trace">
        <p className="py-6 text-center text-[13px] text-muted">
          Awaiting the features layer — store, stream, and timeline land in this panel.
        </p>
      </Panel>
    </AppShell>
  );
}
