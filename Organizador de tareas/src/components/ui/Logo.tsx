type LogoProps = {
  className?: string;
  imgClassName?: string;
  variant?: 'full' | 'symbol';
};

export function Logo({ className = '', imgClassName = '', variant = 'full' }: LogoProps) {
  const src = variant === 'symbol' ? '/logo-gemb-symbol.png' : '/logo-gemb-full.png';
  const alt = variant === 'symbol' ? 'Simbolo dorado GEMB' : 'Logo Gimnasio Emocional Mentes Brillantes';

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <img src={src} alt={alt} className={`h-full w-full object-contain ${imgClassName}`} loading="eager" />
    </div>
  );
}
