import type { ButtonHTMLAttributes, ReactNode } from 'react';

type PremiumButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'cyan';
type PremiumButtonSize = 'sm' | 'md' | 'lg';

type PremiumButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: PremiumButtonVariant;
  size?: PremiumButtonSize;
};

const variantClass: Record<PremiumButtonVariant, string> = {
  primary:
    'border-amber-300/60 bg-[linear-gradient(135deg,#fff2b5_0%,#f6b634_35%,#a86107_100%)] text-slate-950 shadow-[0_14px_34px_rgba(246,182,52,0.25)] hover:brightness-110',
  secondary:
    'border-amber-300/24 bg-white/[0.055] text-amber-50 hover:border-amber-200/45 hover:bg-amber-300/10',
  ghost:
    'border-white/10 bg-slate-950/20 text-slate-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white',
  danger:
    'border-red-400/35 bg-red-500/10 text-red-100 hover:bg-red-500/16',
  success:
    'border-emerald-300/35 bg-emerald-400/12 text-emerald-100 hover:bg-emerald-400/18',
  cyan:
    'border-cyan-300/35 bg-cyan-400/12 text-cyan-50 hover:bg-cyan-400/18',
};

const sizeClass: Record<PremiumButtonSize, string> = {
  sm: 'min-h-9 px-3 py-2 text-xs',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-sm',
};

export function PremiumButton({
  children,
  className = '',
  icon,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  ...props
}: PremiumButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-lg border text-center font-bold whitespace-normal transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-55 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
