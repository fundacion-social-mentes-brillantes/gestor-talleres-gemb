import React from 'react';
import { AlertCircle, ExternalLink, Info, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const {
    login,
    authError,
    authErrorCode,
    authNotice,
    isLoggingIn,
    shouldSuggestExternalBrowser,
    openInCompatibleBrowser,
  } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
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
                  {authErrorCode && <p className="mt-1 font-mono text-xs">{authErrorCode}</p>}
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

          <button
            onClick={login}
            disabled={isLoggingIn}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            {isLoggingIn ? 'Preparando inicio de sesion...' : 'Iniciar sesion con Google'}
          </button>

          {shouldSuggestExternalBrowser && (
            <button
              type="button"
              onClick={openInCompatibleBrowser}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink size={16} />
              Abrir en navegador compatible
            </button>
          )}

          <p className="mt-3 text-center text-xs text-gray-500">
            En iPhone recomendamos usar Safari o Chrome y evitar navegadores embebidos de WhatsApp, Instagram o Facebook.
          </p>
        </div>
      </div>
    </div>
  );
}
