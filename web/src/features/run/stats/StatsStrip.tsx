/**
 * Stats strip — the exact tile set/labels/subs from renderStats
 * (app.js:190-201). Values come from useStats() (live ticks while the
 * store commits) plus the first call's headers from the snapshot.
 */
import { Stat } from '@/components/Stat';
import { fmtCost, fmtMs, fmtNum } from '@/lib/fmt';
import { useRunSnapshot, useStats } from '../hooks';

export function StatsStrip() {
  const stats = useStats();
  const snapshot = useRunSnapshot();

  const calls = Object.values(snapshot.calls).sort((a, b) => a.n - b.n);
  const first = calls[0];
  const headers = first?.headers ?? null;

  return (
    <div
      data-testid="stats"
      className="mb-3.5 grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2"
    >
      <Stat label="Wall time" value={fmtMs(stats.wall)} animate={false} />
      <Stat label="LLM time" value={fmtMs(stats.llm)} sub={stats.percents.llm} animate={false} />
      <Stat label="Tool time" value={fmtMs(stats.tool)} sub={stats.percents.tool} animate={false} />
      <Stat label="Overhead" value={fmtMs(stats.overhead)} sub="harness + gaps" animate={false} />
      <Stat
        label="First TTFT"
        value={fmtMs(stats.ttft)}
        sub={headers != null ? `headers at ${fmtMs(headers)}` : null}
        animate={false}
      />
      <Stat
        label="Avg speed"
        value={stats.avgSpeed != null ? `${stats.avgSpeed} tok/s` : '—'}
        sub="after first token"
        animate={false}
      />
      <Stat
        label="Turns"
        value={fmtNum(stats.turns)}
        sub={`${stats.toolCalls} tool calls${stats.toolErrors ? `, ${stats.toolErrors} failed` : ''}`}
        animate={false}
      />
      <Stat
        label="Tokens in"
        value={fmtNum(stats.tokensIn)}
        sub={stats.cached ? `${fmtNum(stats.cached)} cached` : 'summed over turns'}
        animate={false}
      />
      <Stat
        label="Tokens out"
        value={fmtNum(stats.tokensOut)}
        sub={stats.reasoning ? `${fmtNum(stats.reasoning)} reasoning` : null}
        animate={false}
      />
      {stats.cost != null ? (
        <Stat label="Cost" value={fmtCost(stats.cost)} animate={false} />
      ) : null}
    </div>
  );
}
