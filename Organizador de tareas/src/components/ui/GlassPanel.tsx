import type { HTMLAttributes } from 'react';

type GlassPanelTone = 'default' | 'gold' | 'cyan' | 'emerald' | 'rose';

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  tone?: GlassPanelTone;
};

const toneClass: Record<GlassPanelTone, string> = {
  default: 'border-white/10 bg-white/[0.055]',
  gold: 'border-amber-300/24 bg-amber-300/[0.055] shadow-[0_18px_48px_rgba(246,182,52,0.08)]',
  cyan: 'border-cyan-300/20 bg-cyan-300/[0.045]',
  emerald: 'border-emerald-300/20 bg-emerald-300/[0.045]',
  rose: 'border-rose-300/22 bg-rose-300/[0.045]',
};

export function GlassPanel({ children, className = '', padded = true, tone = 'default', ...props }: GlassPanelProps) {
  return (
    <div
      {...props}
      className={`relative overflow-hidden rounded-lg border shadow-[0_20px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl ${toneClass[tone]} ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
