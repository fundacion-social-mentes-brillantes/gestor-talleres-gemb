import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfigFile from '../../firebase-applet-config.json';

type FirebaseConfigWithDatabaseId = typeof firebaseConfigFile & {
  firestoreDatabaseId?: string;
};

function envValue(key: string) {
  const value = import.meta.env[key] as string | undefined;
  return value && value.trim() ? value.trim() : undefined;
}

const fallbackConfig = firebaseConfigFile as FirebaseConfigWithDatabaseId;

const firebaseConfig = {
  apiKey: envValue('VITE_FIREBASE_API_KEY') ?? fallbackConfig.apiKey,
  authDomain: envValue('VITE_FIREBASE_AUTH_DOMAIN') ?? fallbackConfig.authDomain,
  projectId: envValue('VITE_FIREBASE_PROJECT_ID') ?? fallbackConfig.projectId,
  storageBucket: envValue('VITE_FIREBASE_STORAGE_BUCKET') ?? fallbackConfig.storageBucket,
  messagingSenderId: envValue('VITE_FIREBASE_MESSAGING_SENDER_ID') ?? fallbackConfig.messagingSenderId,
  appId: envValue('VITE_FIREBASE_APP_ID') ?? fallbackConfig.appId,
  measurementId: envValue('VITE_FIREBASE_MEASUREMENT_ID') ?? fallbackConfig.measurementId,
};

const firestoreDatabaseId = envValue('VITE_FIRESTORE_DATABASE_ID') ?? fallbackConfig.firestoreDatabaseId;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL,
      })) || [],
    },
    operationType,
    path,
  };

  if (import.meta.env.DEV) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }

  throw new Error(errInfo.error);
}
