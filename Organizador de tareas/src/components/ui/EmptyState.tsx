import type { ReactNode } from 'react';

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  title: string;
};

export function EmptyState({ action, description, icon, title }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-amber-200/18 bg-slate-950/26 p-8 text-center">
      {icon && <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-amber-200/20 bg-amber-300/10 text-amber-200">{icon}</div>}
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
