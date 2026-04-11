import React, { useState } from 'react';
import { AlertCircle, Bug, Copy, ExternalLink, Info, LayoutDashboard } from 'lucide-react';
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
    debugLog,
  } = useAuth();

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const handleCopyLink = async () => {
    const copied = await copyCurrentLink();
    setCopyFeedback(copied ? 'Enlace copiado.' : 'No se pudo copiar el enlace.');
  };

  // Tap logo 5 times to reveal debug panel
  const handleLogoTap = () => {
    setTapCount((n) => {
      const next = n + 1;
      if (next >= 5) { setShowDebug(true); return 0; }
      return next;
    });
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
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div
            role="button"
            tabIndex={0}
            aria-label="Logo"
            onClick={handleLogoTap}
            onKeyDown={(e) => e.key === 'Enter' && handleLogoTap()}
            className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg cursor-pointer select-none"
          >
            <LayoutDashboard size={32} className="text-white" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Centro de Control
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Gestiona tus trabajos y tareas pendientes
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 border border-gray-100">

          {authError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">No se pudo iniciar sesion</p>
                  <p>{authError}</p>
                  {authErrorCode && <p className="mt-1 font-mono text-xs opacity-70">{authErrorCode}</p>}
                </div>
              </div>
            </div>
          )}

          {authNotice && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <Info size={18} className="mt-0.5 shrink-0" />
                <p>{authNotice}</p>
              </div>
            </div>
          )}

          {browserHelpText && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-medium">{platformTitle}</p>
              <p className="mt-1">{browserHelpText}</p>
            </div>
          )}

          <button
            id="login-btn"
            onClick={login}
            disabled={isLoggingIn}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            {isLoggingIn ? 'Preparando inicio de sesion...' : 'Iniciar sesion con Google'}
          </button>

          {shouldSuggestExternalBrowser && (
            <>
              <button
                type="button"
                id="open-browser-btn"
                onClick={openInCompatibleBrowser}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ExternalLink size={16} />
                {ctaLabel}
              </button>

              <button
                type="button"
                id="copy-link-btn"
                onClick={handleCopyLink}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Copy size={16} />
                Copiar enlace
              </button>

              {copyFeedback && (
                <p className="mt-2 text-center text-xs text-gray-500">{copyFeedback}</p>
              )}
            </>
          )}

          <p className="mt-3 text-center text-xs text-gray-500">{platformNote}</p>

          {/* Debug toggle button */}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setShowDebug((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Mostrar diagnóstico"
            >
              <Bug size={12} />
              {showDebug ? 'Ocultar diagnóstico' : 'Ver diagnóstico'}
            </button>
          </div>

          {/* Debug panel */}
          {showDebug && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">
                Log de autenticacion (copia esto si hay error)
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {debugLog.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Sin eventos aun. Intenta iniciar sesion.</p>
                ) : (
                  debugLog.map((line, i) => (
                    <p key={i} className="text-xs font-mono text-gray-700 break-all leading-4">{line}</p>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(debugLog.join('\n'))}
                className="mt-2 text-xs text-blue-600 hover:underline"
              >
                Copiar log completo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
