import React, { useState } from 'react';
import { AlertCircle, Copy, ExternalLink, Flame, Info, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,#f9731633,transparent_36%),radial-gradient(circle_at_bottom_right,#22d3ee22,transparent_32%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-300 via-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/30">
              <Flame size={38} />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">Gimnasio Emocional</p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-white">Gestor de Talleres GEMB</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Administra talleres, asistentes, pagos, asistencia y orden de llegada con Firebase.
            </p>
          </div>

          {authError && (
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm text-red-100">
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
            <div className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <Info size={18} className="mt-0.5 shrink-0 text-amber-200" />
                <p>{authNotice}</p>
              </div>
            </div>
          )}

          {browserHelpText && (
            <div className="mb-4 rounded-2xl border border-cyan-300/30 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
              <p className="font-black">{platformTitle}</p>
              <p className="mt-1 text-cyan-100/90">{browserHelpText}</p>
            </div>
          )}

          <button
            id="login-btn"
            onClick={login}
            disabled={isLoggingIn}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-orange-500/50"
          >
            <ShieldCheck size={18} />
            {isLoggingIn ? 'Preparando inicio de sesión...' : 'Iniciar sesión con Google'}
          </button>

          {shouldSuggestExternalBrowser && (
            <>
              <button
                type="button"
                id="open-browser-btn"
                onClick={openInCompatibleBrowser}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-white/5"
              >
                <ExternalLink size={16} />
                {ctaLabel}
              </button>

              <button
                type="button"
                id="copy-link-btn"
                onClick={handleCopyLink}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-white/5"
              >
                <Copy size={16} />
                Copiar enlace
              </button>

              {copyFeedback && <p className="mt-2 text-center text-xs text-slate-400">{copyFeedback}</p>}
            </>
          )}

          <p className="mt-5 text-center text-xs leading-5 text-slate-500">{platformNote}</p>
        </div>
      </div>
    </div>
  );
}
