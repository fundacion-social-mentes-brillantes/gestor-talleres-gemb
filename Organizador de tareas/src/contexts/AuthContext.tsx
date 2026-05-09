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
import { auth, db, googleProvider } from '../lib/firebase';
import { User } from '../types';

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
  openInCompatibleBrowser: () => void;
  copyCurrentLink: () => Promise<boolean>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function detectBrowserContext(): BrowserContextInfo {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const vendor = typeof navigator === 'undefined' ? '' : navigator.vendor || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  const isBrave = /Brave/i.test(userAgent) || (typeof navigator !== 'undefined' && 'brave' in navigator);
  const isWhatsApp = /WhatsApp/i.test(userAgent);
  const isInstagram = /Instagram/i.test(userAgent);
  const isFacebook = /FBAN|FBAV|FB_IAB|FB4A/i.test(userAgent);
  const isLine = /Line/i.test(userAgent);
  const isTelegram = /Telegram/i.test(userAgent);
  const isEmbedded = isWhatsApp || isInstagram || isFacebook || isLine || isTelegram;
  const isBraveMobile = isBrave && isMobile;

  let browserName = 'este navegador';
  if (/CriOS/i.test(userAgent)) browserName = 'Chrome';
  else if (isBrave) browserName = 'Brave';
  else if (/Safari/i.test(userAgent) && /Apple/i.test(vendor)) browserName = 'Safari';
  else if (/Chrome/i.test(userAgent) && !/Chromium/i.test(userAgent)) browserName = 'Chrome';

  return { isMobile, isIOS, isAndroid, isBrave, isBraveMobile, isEmbedded, browserName, recommendedBrowser: isIOS ? 'Safari' : 'Chrome' };
}

function getBrowserHelpText(browserContext: BrowserContextInfo) {
  if (browserContext.isIOS) {
    return 'Abre este enlace en Safari. En iPhone, toca el menu del navegador actual y elige Abrir en Safari. Si no aparece, copia el enlace y pegalo manualmente en Safari.';
  }

  if (browserContext.isAndroid) {
    return 'Abre este enlace en Chrome. En Android, toca el menu del navegador actual y elige Abrir en Chrome. Si no aparece, copia el enlace y pegalo en Chrome.';
  }

  return `Abre este enlace en ${browserContext.recommendedBrowser} para iniciar sesion con mas estabilidad.`;
}

function getFirebaseErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
}

function isPermissionError(error: unknown) {
  const code = getFirebaseErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return code === 'permission-denied' || code === 'firestore/permission-denied' || message.includes('permission') || message.includes('missing or insufficient permissions');
}

function getAuthErrorMessage(code: string | null, browserContext?: BrowserContextInfo | null) {
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Este dominio no esta autorizado en Firebase Auth. Agrega el dominio de Vercel en Authentication > Settings > Authorized domains.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueo la ventana emergente. Intentaremos continuar con redireccion.';
    case 'auth/popup-closed-by-user':
      return 'La ventana de inicio de sesion se cerro antes de completar el acceso.';
    case 'auth/cancelled-popup-request':
      return 'Se cancelo el intento anterior de inicio de sesion. Intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Firebase. Revisa tu conexion e intentalo nuevamente.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'Este navegador no permite el flujo de autenticacion. Abre la app en un navegador compatible.';
    case 'auth/persistence-unavailable':
      return 'Este navegador no permite guardar la sesion de forma confiable. Abre la app en un navegador compatible como Safari o Chrome.';
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

function buildUserProfile(firebaseUser: typeof auth.currentUser): User {
  if (!firebaseUser) throw new Error('No hay usuario autenticado.');
  return {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName || 'Usuario',
    email: firebaseUser.email || '',
    photoURL: firebaseUser.photoURL || '',
    role: 'collaborator',
    createdAt: new Date().toISOString(),
  };
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
  const browserContext = useMemo(() => detectBrowserContext(), []);

  useEffect(() => {
    let isActive = true;

    if (browserContext.isEmbedded) {
      setShouldSuggestExternalBrowser(true);
      setBrowserHelpText(getBrowserHelpText(browserContext));
      setAuthNotice(`Estas abriendo la app dentro de un navegador embebido. Para iniciar sesion usa ${browserContext.recommendedBrowser}.`);
    } else if (browserContext.isBraveMobile) {
      setShouldSuggestExternalBrowser(true);
      setBrowserHelpText(getBrowserHelpText(browserContext));
      setAuthNotice(`Brave en celular no es compatible con el inicio de sesion. Abre la app en ${browserContext.recommendedBrowser} para continuar.`);
    }

    configurePersistence().then((result) => {
      if (!isActive) return;
      if (result.mode === 'none') {
        setAuthErrorCode('auth/persistence-unavailable');
        setAuthError(getAuthErrorMessage('auth/persistence-unavailable', browserContext));
        setBrowserHelpText(getBrowserHelpText(browserContext));
        setShouldSuggestExternalBrowser(true);
      } else if (result.mode === 'session') {
        setAuthNotice('La sesion se guardara solo durante esta pestana para maximizar compatibilidad en este navegador.');
      }
    });

    getRedirectResult(auth).catch((error) => {
      if (!isActive) return;
      const code = getFirebaseErrorCode(error);
      setAuthErrorCode(code);
      setAuthError(getAuthErrorMessage(code, browserContext));
      setBrowserHelpText(getBrowserHelpText(browserContext));
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isActive) return;

      try {
        if (!firebaseUser) {
          setUser(null);
          return;
        }

        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          setUser(userDoc.data() as User);
        } else {
          const newUser = buildUserProfile(firebaseUser);
          await setDoc(userDocRef, newUser);
          setUser(newUser);
        }

        setAuthError(null);
        setAuthErrorCode(null);
        setAuthNotice(null);
        setBrowserHelpText(null);
        setShouldSuggestExternalBrowser(false);
      } catch (error) {
        const email = firebaseUser?.email || 'este correo';
        console.error('Error loading user profile:', error);
        setUser(null);

        if (isPermissionError(error)) {
          setAuthErrorCode('firestore/permission-denied');
          setAuthError(`La cuenta ${email} inicio sesion con Google, pero no esta autorizada en Firestore. Agrega este correo en Firebase > Firestore > Reglas, o entra con un correo autorizado.`);
        } else {
          setAuthErrorCode(getFirebaseErrorCode(error) || 'firestore/profile-error');
          setAuthError(`No se pudo preparar el perfil de usuario (${email}). ${getErrorMessage(error)}`);
        }

        await signOut(auth).catch(() => {});
      } finally {
        if (isActive) {
          setIsLoggingIn(false);
          setLoading(false);
        }
      }
    });

    const fallbackTimer = setTimeout(() => {
      if (!isActive) return;
      setIsLoggingIn(false);
      setLoading(false);
    }, 8000);

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
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setAuthNotice(browserContext.isIOS ? 'Enlace copiado. Ahora abre Safari y pega el enlace para iniciar sesion.' : `Enlace copiado. Abrelo en ${browserContext.recommendedBrowser}.`);
      return true;
    } catch {
      return false;
    }
  };

  const login = async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    setIsLoggingIn(true);
    const latestContext = detectBrowserContext();

    if (latestContext.isEmbedded || latestContext.isBraveMobile) {
      setAuthErrorCode('auth/embedded-browser-blocked');
      setAuthError(getAuthErrorMessage('auth/embedded-browser-blocked', latestContext));
      setBrowserHelpText(getBrowserHelpText(latestContext));
      setShouldSuggestExternalBrowser(true);
      setIsLoggingIn(false);
      return;
    }

    const persistenceResult = await configurePersistence();
    if (persistenceResult.mode === 'none') {
      setAuthErrorCode('auth/persistence-unavailable');
      setAuthError(getAuthErrorMessage('auth/persistence-unavailable', latestContext));
      setBrowserHelpText(getBrowserHelpText(latestContext));
      setShouldSuggestExternalBrowser(true);
      setIsLoggingIn(false);
      return;
    }

    setAuthNotice(persistenceResult.mode === 'session' ? 'La sesion se guardara solo durante esta pestana para maximizar compatibilidad en este navegador.' : null);

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code = getFirebaseErrorCode(error);
      const shouldFallbackToRedirect = code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment';

      if (shouldFallbackToRedirect) {
        try {
          setAuthNotice(getAuthErrorMessage(code, latestContext));
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          const redirectCode = getFirebaseErrorCode(redirectError);
          setAuthErrorCode(redirectCode);
          setAuthError(getAuthErrorMessage(redirectCode, latestContext));
          setBrowserHelpText(getBrowserHelpText(latestContext));
          console.error('Error logging in with redirect fallback:', redirectError);
          setIsLoggingIn(false);
          return;
        }
      }

      const userCancelled = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
      if (!userCancelled) {
        setAuthErrorCode(code);
        setAuthError(getAuthErrorMessage(code, latestContext));
        setBrowserHelpText(getBrowserHelpText(latestContext));
        console.error('Error logging in:', error);
      }
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, authError, authErrorCode, authNotice, browserHelpText, isLoggingIn, isEmbeddedBrowser: browserContext.isEmbedded, isIOS: browserContext.isIOS, isAndroid: browserContext.isAndroid, shouldSuggestExternalBrowser, openInCompatibleBrowser, copyCurrentLink, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
