import type { ReactNode } from 'react';

type MetricTone = 'gold' | 'emerald' | 'rose' | 'cyan' | 'violet';

type MetricCardProps = {
  detail?: string;
  icon: ReactNode;
  progress?: number;
  title: string;
  tone?: MetricTone;
  value: ReactNode;
};

const toneClass: Record<MetricTone, { border: string; icon: string; progress: string; glow: string }> = {
  gold: {
    border: 'border-amber-300/24',
    icon: 'border-amber-300/24 bg-amber-300/10 text-amber-200',
    progress: 'from-amber-200 via-amber-400 to-orange-500',
    glow: 'shadow-[0_18px_50px_rgba(246,182,52,0.10)]',
  },
  emerald: {
    border: 'border-emerald-300/20',
    icon: 'border-emerald-300/24 bg-emerald-300/10 text-emerald-200',
    progress: 'from-emerald-200 via-emerald-400 to-teal-400',
    glow: 'shadow-[0_18px_50px_rgba(52,211,153,0.08)]',
  },
  rose: {
    border: 'border-rose-300/22',
    icon: 'border-rose-300/24 bg-rose-300/10 text-rose-200',
    progress: 'from-rose-200 via-rose-400 to-red-400',
    glow: 'shadow-[0_18px_50px_rgba(251,113,133,0.08)]',
  },
  cyan: {
    border: 'border-cyan-300/22',
    icon: 'border-cyan-300/24 bg-cyan-300/10 text-cyan-200',
    progress: 'from-cyan-200 via-sky-400 to-blue-400',
    glow: 'shadow-[0_18px_50px_rgba(56,189,248,0.08)]',
  },
  violet: {
    border: 'border-violet-300/22',
    icon: 'border-violet-300/24 bg-violet-300/10 text-violet-200',
    progress: 'from-violet-200 via-violet-400 to-fuchsia-400',
    glow: 'shadow-[0_18px_50px_rgba(167,139,250,0.08)]',
  },
};

export function MetricCard({ detail, icon, progress, title, tone = 'gold', value }: MetricCardProps) {
  const clampedProgress = Math.max(0, Math.min(progress ?? 100, 100));
  const toneStyles = toneClass[tone];

  return (
    <article className={`rounded-lg border bg-white/[0.052] p-5 backdrop-blur-2xl ${toneStyles.border} ${toneStyles.glow}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-slate-300">{title}</p>
          <p className="mt-3 truncate text-3xl font-black text-white">{value}</p>
          {detail && <p className="mt-2 text-sm font-medium text-slate-400">{detail}</p>}
        </div>
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${toneStyles.icon}`}>{icon}</div>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className={`h-full rounded-full bg-gradient-to-r ${toneStyles.progress}`} style={{ width: `${clampedProgress}%` }} />
      </div>
    </article>
  );
}
