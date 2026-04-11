import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { User } from '../types';

const OAUTH_IN_PROGRESS_KEY = 'oauth_in_progress';
const OAUTH_CONTEXT_KEY = 'oauth_browser_context';
const OAUTH_STARTED_AT_KEY = 'oauth_started_at';

interface BrowserContextInfo {
  isMobile: boolean;
  isIOS: boolean;
  isBrave: boolean;
  isEmbedded: boolean;
  browserName: string;
  recommendedBrowser: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  authErrorCode: string | null;
  authNotice: string | null;
  isLoggingIn: boolean;
  isEmbeddedBrowser: boolean;
  shouldSuggestExternalBrowser: boolean;
  openInCompatibleBrowser: () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function safeStorage(type: 'localStorage' | 'sessionStorage') {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window[type];
    const probeKey = `__probe_${type}`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function setOAuthFlag(context: BrowserContextInfo) {
  const storages = [safeStorage('localStorage'), safeStorage('sessionStorage')].filter(Boolean) as Storage[];
  const payload = JSON.stringify(context);
  const startedAt = String(Date.now());

  storages.forEach((storage) => {
    storage.setItem(OAUTH_IN_PROGRESS_KEY, '1');
    storage.setItem(OAUTH_CONTEXT_KEY, payload);
    storage.setItem(OAUTH_STARTED_AT_KEY, startedAt);
  });
}

function clearOAuthFlag() {
  const storages = [safeStorage('localStorage'), safeStorage('sessionStorage')].filter(Boolean) as Storage[];
  storages.forEach((storage) => {
    storage.removeItem(OAUTH_IN_PROGRESS_KEY);
    storage.removeItem(OAUTH_CONTEXT_KEY);
    storage.removeItem(OAUTH_STARTED_AT_KEY);
  });
}

function readOAuthFlag() {
  const storages = [safeStorage('sessionStorage'), safeStorage('localStorage')].filter(Boolean) as Storage[];

  for (const storage of storages) {
    const inProgress = storage.getItem(OAUTH_IN_PROGRESS_KEY) === '1';
    const rawContext = storage.getItem(OAUTH_CONTEXT_KEY);
    const startedAt = storage.getItem(OAUTH_STARTED_AT_KEY);

    if (inProgress || rawContext || startedAt) {
      return {
        inProgress,
        rawContext,
        startedAt: startedAt ? Number(startedAt) : null,
      };
    }
  }

  return {
    inProgress: false,
    rawContext: null,
    startedAt: null,
  };
}

function parseStoredContext(rawContext: string | null): BrowserContextInfo | null {
  if (!rawContext) return null;

  try {
    return JSON.parse(rawContext) as BrowserContextInfo;
  } catch {
    return null;
  }
}

function detectBrowserContext(): BrowserContextInfo {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const vendor = typeof navigator === 'undefined' ? '' : navigator.vendor || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  const isBrave = /Brave/i.test(userAgent)
    || (typeof navigator !== 'undefined' && 'brave' in navigator);
  const isWhatsApp = /WhatsApp/i.test(userAgent);
  const isInstagram = /Instagram/i.test(userAgent);
  const isFacebook = /FBAN|FBAV|FB_IAB|FB4A/i.test(userAgent);
  const isLine = /Line/i.test(userAgent);
  const isTelegram = /Telegram/i.test(userAgent);
  const isEmbedded = isWhatsApp || isInstagram || isFacebook || isLine || isTelegram;

  let browserName = 'este navegador';
  if (/CriOS/i.test(userAgent)) browserName = 'Chrome';
  else if (isBrave) browserName = 'Brave';
  else if (/Safari/i.test(userAgent) && /Apple/i.test(vendor)) browserName = 'Safari';

  return {
    isMobile,
    isIOS,
    isBrave,
    isEmbedded,
    browserName,
    recommendedBrowser: isIOS ? 'Safari' : 'Chrome',
  };
}

function getFirebaseErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

function getAuthErrorMessage(code: string | null, browserContext?: BrowserContextInfo | null) {
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Este dominio no esta autorizado en Firebase Auth. Agrega gestor-tareas-ia.vercel.app en Authentication > Settings > Authorized domains.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueo la ventana emergente. Intentaremos continuar con redireccion.';
    case 'auth/popup-closed-by-user':
      return 'La ventana de inicio de sesion se cerro antes de completar el acceso. Intentaremos continuar con redireccion.';
    case 'auth/cancelled-popup-request':
      return 'Se cancelo el intento anterior de inicio de sesion. Intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Firebase. Revisa tu conexion e intentalo nuevamente.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'Este navegador no permite el flujo de autenticacion. Abre la app en un navegador compatible.';
    case 'auth/persistence-unavailable':
      return 'Este navegador no permite guardar la sesion de forma confiable. Abre la app en un navegador compatible como Safari o Chrome.';
    case 'auth/redirect-not-completed':
      return `No pudimos recuperar la sesion despues del redirect. Abre este enlace en ${browserContext?.recommendedBrowser || 'un navegador compatible'} y vuelve a intentarlo.`;
    case 'auth/embedded-browser-blocked':
      return `Este navegador embebido no es compatible con el login. Abre este enlace en ${browserContext?.recommendedBrowser || 'un navegador compatible'} para iniciar sesion.`;
    default:
      return 'No fue posible iniciar sesion con Google. Intentalo nuevamente.';
  }
}

async function configurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return { mode: 'local' as const };
  } catch {
    try {
      await setPersistence(auth, browserSessionPersistence);
      return { mode: 'session' as const };
    } catch {
      return { mode: 'none' as const };
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [shouldSuggestExternalBrowser, setShouldSuggestExternalBrowser] = useState(false);
  const browserContext = useMemo(() => detectBrowserContext(), []);

  useEffect(() => {
    let isActive = true;
    let authStateKnown = false;
    let redirectChecked = false;

    const updateLoading = () => {
      if (isActive && authStateKnown && redirectChecked) {
        setLoading(false);
      }
    };

    const pendingOAuth = readOAuthFlag();
    const pendingBrowserContext = parseStoredContext(pendingOAuth.rawContext);

    if (browserContext.isEmbedded) {
      setShouldSuggestExternalBrowser(true);
      setAuthNotice(`Estas abriendo la app dentro de un navegador embebido. Para iniciar sesion usa ${browserContext.recommendedBrowser}.`);
    } else if (browserContext.isBrave && browserContext.isIOS) {
      setAuthNotice('Si el redirect no completa en iPhone, abre la app en Safari para una sesion mas estable.');
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isActive) return;
      authStateKnown = true;

      if (firebaseUser) {
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            setUser(userDoc.data() as User);
          } else {
            const newUser: User = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Usuario',
              email: firebaseUser.email || '',
              photoURL: firebaseUser.photoURL || '',
              role: 'collaborator',
              createdAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, newUser);
            setUser(newUser);
          }

          clearOAuthFlag();
          setAuthError(null);
          setAuthErrorCode(null);
          setAuthNotice(null);
          setShouldSuggestExternalBrowser(false);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      } else {
        setUser(null);
      }

      setIsLoggingIn(false);
      updateLoading();
    });

    (async () => {
      const persistenceResult = await configurePersistence();
      if (!isActive) return;

      if (persistenceResult.mode === 'none') {
        setAuthErrorCode('auth/persistence-unavailable');
        setAuthError(getAuthErrorMessage('auth/persistence-unavailable'));
        setShouldSuggestExternalBrowser(true);
      } else if (persistenceResult.mode === 'session') {
        setAuthNotice('La sesion se guardara solo durante esta pestana para maximizar compatibilidad en este navegador.');
      }

      try {
        const redirectResult = await getRedirectResult(auth);
        if (!isActive) return;

        redirectChecked = true;

        if (redirectResult?.user) {
          clearOAuthFlag();
        } else if (pendingOAuth.inProgress && !auth.currentUser) {
          const contextForMessage = pendingBrowserContext || browserContext;
          const code = browserContext.isEmbedded || contextForMessage?.isEmbedded
            ? 'auth/embedded-browser-blocked'
            : 'auth/redirect-not-completed';

          setAuthErrorCode(code);
          setAuthError(getAuthErrorMessage(code, contextForMessage));
          setShouldSuggestExternalBrowser(true);
        }
      } catch (error) {
        if (!isActive) return;
        redirectChecked = true;
        const code = getFirebaseErrorCode(error);
        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, pendingBrowserContext || browserContext));
        console.error('Error finishing redirect login:', error);
      }

      updateLoading();
    })();

    const fallbackTimer = setTimeout(() => {
      if (!isActive) return;
      if (!authStateKnown) authStateKnown = true;
      if (!redirectChecked) redirectChecked = true;

      if (pendingOAuth.inProgress && !auth.currentUser) {
        const contextForMessage = pendingBrowserContext || browserContext;
        const code = contextForMessage?.isEmbedded ? 'auth/embedded-browser-blocked' : 'auth/redirect-not-completed';
        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, contextForMessage));
        setShouldSuggestExternalBrowser(true);
      }

      updateLoading();
    }, 6000);

    return () => {
      isActive = false;
      clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, [browserContext]);

  const openInCompatibleBrowser = () => {
    if (typeof window === 'undefined') return;
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const login = async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    setIsLoggingIn(true);

    const latestContext = detectBrowserContext();

    if (latestContext.isEmbedded) {
      setOAuthFlag(latestContext);
      setAuthErrorCode('auth/embedded-browser-blocked');
      setAuthError(getAuthErrorMessage('auth/embedded-browser-blocked', latestContext));
      setShouldSuggestExternalBrowser(true);
      setIsLoggingIn(false);
      return;
    }

    const persistenceResult = await configurePersistence();

    if (persistenceResult.mode === 'none') {
      setAuthErrorCode('auth/persistence-unavailable');
      setAuthError(getAuthErrorMessage('auth/persistence-unavailable', latestContext));
      setShouldSuggestExternalBrowser(true);
      setIsLoggingIn(false);
      return;
    }

    if (persistenceResult.mode === 'session') {
      setAuthNotice('La sesion se guardara solo durante esta pestana para maximizar compatibilidad en este navegador.');
    } else {
      setAuthNotice(null);
    }

    setOAuthFlag(latestContext);

    try {
      if (latestContext.isMobile) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      await signInWithPopup(auth, googleProvider);
      clearOAuthFlag();
    } catch (error) {
      const code = getFirebaseErrorCode(error);
      const shouldFallbackToRedirect =
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/operation-not-supported-in-this-environment';

      if (shouldFallbackToRedirect) {
        try {
          setAuthNotice(getAuthErrorMessage(code, latestContext));
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          const redirectCode = getFirebaseErrorCode(redirectError);
          setAuthErrorCode(redirectCode);
          setAuthError(getAuthErrorMessage(redirectCode, latestContext));
          console.error('Error logging in with redirect fallback:', redirectError);
          setIsLoggingIn(false);
          clearOAuthFlag();
          return;
        }
      }

      setAuthErrorCode(code);
      setAuthError(getAuthErrorMessage(code, latestContext));
      console.error('Error logging in:', error);
      setIsLoggingIn(false);
      clearOAuthFlag();
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        authErrorCode,
        authNotice,
        isLoggingIn,
        isEmbeddedBrowser: browserContext.isEmbedded,
        shouldSuggestExternalBrowser,
        openInCompatibleBrowser,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
