import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
const OAUTH_FLAG_MAX_AGE_MS = 10 * 60 * 1000;

interface BrowserContextInfo {
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isBrave: boolean;
  isEmbedded: boolean;
  isBraveMobile: boolean;
  browserName: string;
  recommendedBrowser: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  authErrorCode: string | null;
  authNotice: string | null;
  browserHelpText: string | null;
  isLoggingIn: boolean;
  isEmbeddedBrowser: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  shouldSuggestExternalBrowser: boolean;
  debugLog: string[];
  openInCompatibleBrowser: () => void;
  copyCurrentLink: () => Promise<boolean>;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function safeStorage(type: 'localStorage' | 'sessionStorage') {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window[type];
    const k = `__probe_${type}`;
    storage.setItem(k, '1');
    storage.removeItem(k);
    return storage;
  } catch {
    return null;
  }
}

function setOAuthFlag(context: BrowserContextInfo) {
  const storages = [safeStorage('localStorage'), safeStorage('sessionStorage')].filter(Boolean) as Storage[];
  const payload = JSON.stringify(context);
  const startedAt = String(Date.now());
  storages.forEach((s) => {
    s.setItem(OAUTH_IN_PROGRESS_KEY, '1');
    s.setItem(OAUTH_CONTEXT_KEY, payload);
    s.setItem(OAUTH_STARTED_AT_KEY, startedAt);
  });
}

function clearOAuthFlag() {
  const storages = [safeStorage('localStorage'), safeStorage('sessionStorage')].filter(Boolean) as Storage[];
  storages.forEach((s) => {
    s.removeItem(OAUTH_IN_PROGRESS_KEY);
    s.removeItem(OAUTH_CONTEXT_KEY);
    s.removeItem(OAUTH_STARTED_AT_KEY);
  });
}

function readOAuthFlag() {
  const storages = [safeStorage('sessionStorage'), safeStorage('localStorage')].filter(Boolean) as Storage[];
  for (const storage of storages) {
    const inProgress = storage.getItem(OAUTH_IN_PROGRESS_KEY) === '1';
    const rawContext = storage.getItem(OAUTH_CONTEXT_KEY);
    const startedAt = storage.getItem(OAUTH_STARTED_AT_KEY);
    const startedAtMs = startedAt ? Number(startedAt) : null;
    const isExpired = !startedAtMs || Number.isNaN(startedAtMs) || Date.now() - startedAtMs > OAUTH_FLAG_MAX_AGE_MS;
    if (inProgress || rawContext || startedAt) {
      if (isExpired) {
        storage.removeItem(OAUTH_IN_PROGRESS_KEY);
        storage.removeItem(OAUTH_CONTEXT_KEY);
        storage.removeItem(OAUTH_STARTED_AT_KEY);
        continue;
      }
      return { inProgress, rawContext, startedAt: startedAtMs };
    }
  }
  return { inProgress: false, rawContext: null, startedAt: null };
}

function parseStoredContext(rawContext: string | null): BrowserContextInfo | null {
  if (!rawContext) return null;
  try { return JSON.parse(rawContext) as BrowserContextInfo; } catch { return null; }
}

function detectBrowserContext(): BrowserContextInfo {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const vendor = typeof navigator === 'undefined' ? '' : navigator.vendor || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  const isBrave = /Brave/i.test(ua) || (typeof navigator !== 'undefined' && 'brave' in navigator);
  const isWhatsApp = /WhatsApp/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isFacebook = /FBAN|FBAV|FB_IAB|FB4A/i.test(ua);
  const isLine = /Line/i.test(ua);
  const isTelegram = /Telegram/i.test(ua);
  const isEmbedded = isWhatsApp || isInstagram || isFacebook || isLine || isTelegram;
  const isBraveMobile = isBrave && isMobile;

  let browserName = 'desconocido';
  if (/CriOS/i.test(ua)) browserName = 'Chrome (iOS)';
  else if (isBrave) browserName = 'Brave';
  else if (/EdgA/i.test(ua)) browserName = 'Edge';
  else if (/OPR|Opera/i.test(ua)) browserName = 'Opera';
  else if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) browserName = 'Chrome';
  else if (/Safari/i.test(ua) && /Apple/i.test(vendor)) browserName = 'Safari';
  else if (/Firefox/i.test(ua)) browserName = 'Firefox';

  return {
    isMobile,
    isIOS,
    isAndroid,
    isBrave,
    isBraveMobile,
    isEmbedded,
    browserName,
    recommendedBrowser: isIOS ? 'Safari' : 'Chrome',
  };
}

function getBrowserHelpText(ctx: BrowserContextInfo) {
  if (ctx.isIOS) {
    return 'Abre este enlace en Safari. En iPhone, toca el menu del navegador y elige "Abrir en Safari". Si no aparece, copia el enlace y pegalo en Safari.';
  }
  if (ctx.isAndroid) {
    return 'Abre este enlace en Chrome. En Android, toca el menu del navegador y elige "Abrir en Chrome". Si no aparece, copia el enlace y pegalo en Chrome.';
  }
  return `Abre este enlace en ${ctx.recommendedBrowser} para iniciar sesion con mas estabilidad.`;
}

function getFirebaseErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return null;
}

function getAuthErrorMessage(code: string | null, ctx?: BrowserContextInfo | null) {
  const browser = ctx?.recommendedBrowser || 'un navegador compatible';
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Este dominio no esta autorizado. Revisa Firebase Auth > Authorized domains.';
    case 'auth/popup-blocked':
      return `El navegador bloqueo la ventana emergente de Google. Intenta de nuevo o usa ${browser}.`;
    case 'auth/popup-closed-by-user':
      return 'Cerraste la ventana de login antes de completar el acceso.';
    case 'auth/cancelled-popup-request':
      return 'Se cancelo el intento anterior. Intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar. Revisa tu conexion a internet.';
    case 'auth/operation-not-supported-in-this-environment':
      return `Este navegador no soporta el flujo de login. Usa ${browser}.`;
    case 'auth/persistence-unavailable':
      return `Este navegador no puede guardar la sesion. Usa ${browser}.`;
    case 'auth/redirect-not-completed':
      return `La sesion no pudo recuperarse despues del redirect. Intenta de nuevo en ${browser}.`;
    case 'auth/embedded-browser-blocked':
      return `Este navegador no es compatible con el login. Abre en ${browser}.`;
    default:
      return `No fue posible iniciar sesion con Google (${code || 'error desconocido'}). Intentalo de nuevo.`;
  }
}

// Run persistence config once; won't block the popup call
async function configurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return 'local' as const;
  } catch {
    try {
      await setPersistence(auth, browserSessionPersistence);
      return 'session' as const;
    } catch {
      return 'none' as const;
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
  const [browserHelpText, setBrowserHelpText] = useState<string | null>(null);
  const [shouldSuggestExternalBrowser, setShouldSuggestExternalBrowser] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const browserContext = useMemo(() => detectBrowserContext(), []);
  // Persistence mode set on mount so it doesn't block login() user gesture
  const persistenceModeRef = useRef<'local' | 'session' | 'none' | 'pending'>('pending');

  const addDebug = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log('[AUTH DEBUG]', line);
    setDebugLog((prev) => [...prev.slice(-19), line]);
  };

  useEffect(() => {
    let isActive = true;
    let authStateKnown = false;
    let redirectChecked = false;

    const updateLoading = () => {
      if (isActive && authStateKnown && redirectChecked) setLoading(false);
    };

    const pendingOAuth = readOAuthFlag();
    const pendingBrowserContext = parseStoredContext(pendingOAuth.rawContext);

    // Log detected browser on mount
    addDebug(`Browser: ${browserContext.browserName} | iOS:${browserContext.isIOS} | Android:${browserContext.isAndroid} | Brave:${browserContext.isBrave} | Mobile:${browserContext.isMobile} | Embedded:${browserContext.isEmbedded}`);
    addDebug(`PendingOAuth flag: inProgress=${pendingOAuth.inProgress} age=${pendingOAuth.startedAt ? Math.round((Date.now() - pendingOAuth.startedAt) / 1000) + 's' : 'n/a'}`);

    if (browserContext.isEmbedded) {
      setShouldSuggestExternalBrowser(true);
      setBrowserHelpText(getBrowserHelpText(browserContext));
      setAuthNotice(`Navegador embebido detectado. Usa ${browserContext.recommendedBrowser}.`);
    } else if (browserContext.isBraveMobile) {
      setShouldSuggestExternalBrowser(true);
      setBrowserHelpText(getBrowserHelpText(browserContext));
      setAuthNotice(`Brave en celular no es compatible. Abre en ${browserContext.recommendedBrowser}.`);
    }

    // Configure persistence in background — does NOT block login() popup call
    configurePersistence().then((mode) => {
      if (!isActive) return;
      persistenceModeRef.current = mode;
      addDebug(`Persistence configured: ${mode}`);
      if (mode === 'none') {
        setAuthErrorCode('auth/persistence-unavailable');
        setAuthError(getAuthErrorMessage('auth/persistence-unavailable', browserContext));
        setBrowserHelpText(getBrowserHelpText(browserContext));
        setShouldSuggestExternalBrowser(true);
      } else if (mode === 'session') {
        setAuthNotice('La sesion se guardara solo durante esta pestana.');
      }
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isActive) return;
      authStateKnown = true;
      addDebug(`onAuthStateChanged: user=${firebaseUser?.email ?? 'null'}`);

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
          setBrowserHelpText(null);
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
      try {
        addDebug('Calling getRedirectResult...');
        const redirectResult = await getRedirectResult(auth);
        if (!isActive) return;
        redirectChecked = true;
        addDebug(`getRedirectResult: user=${redirectResult?.user?.email ?? 'null'}`);

        if (redirectResult?.user) {
          clearOAuthFlag();
        } else if (pendingOAuth.inProgress && !auth.currentUser) {
          const ctx = pendingBrowserContext || browserContext;
          const code = browserContext.isEmbedded || ctx?.isEmbedded
            ? 'auth/embedded-browser-blocked'
            : 'auth/redirect-not-completed';
          addDebug(`Redirect incomplete — code: ${code}`);
          setAuthErrorCode(code);
          setAuthError(getAuthErrorMessage(code, ctx));
          setBrowserHelpText(getBrowserHelpText(ctx));
          setShouldSuggestExternalBrowser(true);
        }
      } catch (error) {
        if (!isActive) return;
        redirectChecked = true;
        const code = getFirebaseErrorCode(error);
        addDebug(`getRedirectResult error: ${code} — ${String(error)}`);
        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, pendingBrowserContext || browserContext));
        setBrowserHelpText(getBrowserHelpText(pendingBrowserContext || browserContext));
        console.error('Error finishing redirect login:', error);
      }
      updateLoading();
    })();

    const fallbackTimer = setTimeout(() => {
      if (!isActive) return;
      if (!authStateKnown) authStateKnown = true;
      if (!redirectChecked) redirectChecked = true;
      if (pendingOAuth.inProgress && !auth.currentUser) {
        const ctx = pendingBrowserContext || browserContext;
        const code = ctx?.isEmbedded ? 'auth/embedded-browser-blocked' : 'auth/redirect-not-completed';
        addDebug(`Fallback timer fired — code: ${code}`);
        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, ctx));
        setBrowserHelpText(getBrowserHelpText(ctx));
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
    if (typeof navigator !== 'undefined' && 'share' in navigator && browserContext.isMobile) {
      navigator.share({ url: window.location.href, title: document.title }).catch(() => {});
      return;
    }
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const copyCurrentLink = async () => {
    if (typeof window === 'undefined' || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setAuthNotice(browserContext.isIOS
        ? 'Enlace copiado. Abre Safari y pega el enlace.'
        : `Enlace copiado. Abrelo en ${browserContext.recommendedBrowser}.`);
      return true;
    } catch {
      return false;
    }
  };

  // NOTE: login() is intentionally NOT async at the top level.
  // signInWithPopup MUST be called within the same synchronous tick as the
  // user click event. Any await before it breaks Android/iOS popup permission.
  const login = () => {
    setAuthError(null);
    setAuthErrorCode(null);

    const ctx = detectBrowserContext();
    addDebug(`login() called — browser: ${ctx.browserName} | mobile: ${ctx.isMobile} | brave: ${ctx.isBrave}`);

    // Sync block: embedded browser
    if (ctx.isEmbedded) {
      addDebug('Blocked: embedded browser');
      setOAuthFlag(ctx);
      setAuthErrorCode('auth/embedded-browser-blocked');
      setAuthError(getAuthErrorMessage('auth/embedded-browser-blocked', ctx));
      setBrowserHelpText(getBrowserHelpText(ctx));
      setShouldSuggestExternalBrowser(true);
      return;
    }

    // Sync block: Brave mobile
    if (ctx.isBraveMobile) {
      addDebug('Blocked: Brave mobile');
      setAuthErrorCode('auth/embedded-browser-blocked');
      setAuthError(`Brave en celular no es compatible con el login de Google. Usa ${ctx.recommendedBrowser}.`);
      setBrowserHelpText(getBrowserHelpText(ctx));
      setShouldSuggestExternalBrowser(true);
      return;
    }

    // Sync block: persistence unavailable (set during mount)
    if (persistenceModeRef.current === 'none') {
      addDebug('Blocked: persistence unavailable');
      setAuthErrorCode('auth/persistence-unavailable');
      setAuthError(getAuthErrorMessage('auth/persistence-unavailable', ctx));
      setBrowserHelpText(getBrowserHelpText(ctx));
      setShouldSuggestExternalBrowser(true);
      return;
    }

    setIsLoggingIn(true);
    setAuthNotice(null);
    setOAuthFlag(ctx);

    // *** signInWithPopup called synchronously — no await before this point ***
    // This is critical: mobile browsers (Android Chrome, Safari iOS) only allow
    // popups within the same event loop tick as a direct user gesture.
    addDebug('Calling signInWithPopup (sync within click handler)...');

    signInWithPopup(auth, googleProvider)
      .then(() => {
        addDebug('signInWithPopup: SUCCESS');
        clearOAuthFlag();
        // isLoggingIn reset by onAuthStateChanged
      })
      .catch(async (error: unknown) => {
        const code = getFirebaseErrorCode(error);
        addDebug(`signInWithPopup error: ${code} — ${String(error)}`);

        const shouldFallbackToRedirect =
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment';

        if (shouldFallbackToRedirect) {
          addDebug(`Popup blocked — falling back to signInWithRedirect`);
          setAuthNotice('Ventana emergente bloqueada. Redirigiendo...');
          try {
            await signInWithRedirect(auth, googleProvider);
            // page will navigate away
          } catch (redirectError) {
            const redirectCode = getFirebaseErrorCode(redirectError);
            addDebug(`signInWithRedirect error: ${redirectCode}`);
            setAuthErrorCode(redirectCode);
            setAuthError(getAuthErrorMessage(redirectCode, ctx));
            setBrowserHelpText(getBrowserHelpText(ctx));
            setIsLoggingIn(false);
            clearOAuthFlag();
          }
          return;
        }

        // User cancelled intentionally — don't show error, just reset
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          addDebug('User closed popup — no error shown');
          setIsLoggingIn(false);
          clearOAuthFlag();
          return;
        }

        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, ctx));
        setBrowserHelpText(getBrowserHelpText(ctx));
        setIsLoggingIn(false);
        clearOAuthFlag();
      });
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
        browserHelpText,
        isLoggingIn,
        isEmbeddedBrowser: browserContext.isEmbedded,
        isIOS: browserContext.isIOS,
        isAndroid: browserContext.isAndroid,
        shouldSuggestExternalBrowser,
        debugLog,
        openInCompatibleBrowser,
        copyCurrentLink,
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
