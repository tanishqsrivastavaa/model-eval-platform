import { Link } from 'react-router';
import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-6 text-center">
      <Logo size={32} className="text-accent" />
      <p className="label text-accent">error 404</p>
      <h1 className="max-w-[20ch] text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-fg">
        No signal at this address.
      </h1>
      <p className="max-w-[42ch] text-[13.5px] text-fg-2">
        The run you’re looking for may have been cleared, or the link never pointed anywhere.
      </p>
      <Link to="/" aria-label="Back to home">
        <Button variant="primary" size="sm" className="mt-1">
          Back to the console
        </Button>
      </Link>
    </div>
  );
}
