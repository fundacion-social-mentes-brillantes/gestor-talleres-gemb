import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  authErrorCode: string | null;
  isLoggingIn: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getFirebaseErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

function isMobileOrRestrictiveBrowser() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function getAuthErrorMessage(code: string | null) {
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
      return 'Este navegador no permite el flujo emergente. Intentaremos continuar con redireccion.';
    default:
      return 'No fue posible iniciar sesion con Google. Intentalo nuevamente.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let authResolved = false;

    getRedirectResult(auth).catch((error) => {
      const code = getFirebaseErrorCode(error);
      setAuthErrorCode(code);
      setAuthError(getAuthErrorMessage(code));
      setIsLoggingIn(false);
      console.error('Error finishing redirect login:', error);
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      authResolved = true;

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

          setAuthError(null);
          setAuthErrorCode(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      } else {
        setUser(null);
      }

      setIsLoggingIn(false);
      setLoading(false);
    });

    const fallbackTimer = setTimeout(() => {
      if (!authResolved) {
        setLoading(false);
      }
    }, 5000);

    return () => {
      clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  const login = async () => {
    setAuthError(null);
    setAuthErrorCode(null);
    setIsLoggingIn(true);

    try {
      if (isMobileOrRestrictiveBrowser()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code = getFirebaseErrorCode(error);
      const shouldFallbackToRedirect =
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/operation-not-supported-in-this-environment';

      if (shouldFallbackToRedirect) {
        try {
          setAuthError(getAuthErrorMessage(code));
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          const redirectCode = getFirebaseErrorCode(redirectError);
          setAuthErrorCode(redirectCode);
          setAuthError(getAuthErrorMessage(redirectCode));
          console.error('Error logging in with redirect fallback:', redirectError);
          setIsLoggingIn(false);
          return;
        }
      }

      setAuthErrorCode(code);
      setAuthError(getAuthErrorMessage(code));
      console.error('Error logging in:', error);
      setIsLoggingIn(false);
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
    <AuthContext.Provider value={{ user, loading, authError, authErrorCode, isLoggingIn, login, logout }}>
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
