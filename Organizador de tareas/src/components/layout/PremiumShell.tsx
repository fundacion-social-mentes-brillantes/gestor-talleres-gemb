import type { ReactNode } from 'react';

type PremiumShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
};

export function PremiumShell({ children, sidebar }: PremiumShellProps) {
  return (
    <div className="luxury-bg min-h-screen text-slate-100">
      <div className="luxury-grid" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        {sidebar}
        {children}
      </div>
    </div>
  );
}
