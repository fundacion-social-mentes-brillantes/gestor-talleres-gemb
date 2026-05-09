import { useState } from 'react';
import { AlertCircle, Copy, ExternalLink, Info, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { GlassPanel } from './ui/GlassPanel';
import { Logo } from './ui/Logo';
import { PremiumButton } from './ui/PremiumButton';

export function Login() {
  const {
    login,
    authError,
    authErrorCode,
    authNotice,
    browserHelpText,
    isLoggingIn,
    shouldSuggestExternalBrowser,
    openInCompatibleBrowser,
    copyCurrentLink,
    isIOS,
    isAndroid,
  } = useAuth();

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const handleCopyLink = async () => {
    const copied = await copyCurrentLink();
    setCopyFeedback(copied ? 'Enlace copiado.' : 'No se pudo copiar el enlace.');
  };

  const platformTitle = isIOS
    ? 'Abre este enlace en Safari'
    : isAndroid
    ? 'Abre este enlace en Chrome'
    : 'Abre en un navegador compatible';

  const platformNote = isIOS
    ? 'En iPhone recomendamos Safari o Chrome. Evita navegadores embebidos de WhatsApp, Instagram o Facebook.'
    : isAndroid
    ? 'En Android recomendamos Chrome. Evita navegadores embebidos de WhatsApp, Instagram o Facebook.'
    : 'Recomendamos Chrome o Safari. Evita navegadores embebidos.';

  const ctaLabel = isAndroid ? 'Abrir en Chrome' : isIOS ? 'Abrir en Safari' : 'Abrir en navegador compatible';

  return (
    <div className="luxury-bg min-h-screen text-white">
      <div className="luxury-grid" aria-hidden="true" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <GlassPanel tone="gold" className="w-full max-w-[22rem] overflow-hidden sm:max-w-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-5 rounded-lg border border-amber-200/18 bg-black/20 p-3">
              <Logo variant="full" className="mx-auto h-36 w-full" />
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-amber-200/22 bg-amber-300/10 px-3 py-1.5 text-xs font-black uppercase text-amber-100">
              <Sparkles size={14} />
              Acceso seguro GEMB
            </span>
            <h1 className="mt-4 text-3xl font-black leading-tight text-white">Gestor de Talleres</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-300">Administra talleres, asistentes, pagos manuales, asistencia y orden de llegada con una sesión protegida.</p>
          </div>

          {authError && (
            <div className="mb-4 rounded-lg border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm text-red-100">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-300" />
                <div>
                  <p className="font-black">No se pudo iniciar sesión</p>
                  <p className="mt-1 text-red-100/90">{authError}</p>
                  {authErrorCode && <p className="mt-2 font-mono text-xs text-red-200/70">{authErrorCode}</p>}
                </div>
              </div>
            </div>
          )}

          {authNotice && (
            <div className="mb-4 rounded-lg border border-amber-300/30 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <Info size={18} className="mt-0.5 shrink-0 text-amber-200" />
                <p>{authNotice}</p>
              </div>
            </div>
          )}

          {browserHelpText && (
            <div className="mb-4 rounded-lg border border-cyan-300/30 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
              <p className="font-black">{platformTitle}</p>
              <p className="mt-1 text-cyan-100/90">{browserHelpText}</p>
            </div>
          )}

          <PremiumButton
            id="login-btn"
            onClick={login}
            disabled={isLoggingIn}
            className="w-full"
            icon={<ShieldCheck size={18} />}
            variant="primary"
            size="lg"
          >
            {isLoggingIn ? 'Preparando inicio de sesión...' : 'Iniciar sesión con Google'}
          </PremiumButton>

          {shouldSuggestExternalBrowser && (
            <>
              <PremiumButton
                type="button"
                id="open-browser-btn"
                onClick={openInCompatibleBrowser}
                className="mt-3 w-full"
                icon={<ExternalLink size={16} />}
                variant="secondary"
              >
                {ctaLabel}
              </PremiumButton>

              <PremiumButton
                type="button"
                id="copy-link-btn"
                onClick={handleCopyLink}
                className="mt-3 w-full"
                icon={<Copy size={16} />}
                variant="ghost"
              >
                Copiar enlace
              </PremiumButton>

              {copyFeedback && <p className="mt-2 text-center text-xs text-slate-400">{copyFeedback}</p>}
            </>
          )}

          <p className="mt-5 text-center text-xs leading-5 text-slate-500">{platformNote}</p>
        </GlassPanel>
      </div>
    </div>
  );
}
