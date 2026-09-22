/** Small shared card pieces: meta chips and the streaming cursor glyph. */

export function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label ? `${label} ` : ''}
      <b className="font-medium text-fg-2">{value}</b>
    </span>
  );
}

export function Cursor() {
  return <span className="pulse-live text-accent">▍</span>;
}
