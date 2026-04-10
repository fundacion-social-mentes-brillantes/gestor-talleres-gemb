import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ActivityLog } from '../types';
import { useAuth } from '../contexts/AuthContext';

export function useActivityLogs() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setLogs([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => doc.data() as ActivityLog);
      setLogs(logsData);
      setError(null);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      handleFirestoreError(err, OperationType.LIST, 'activity_logs');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  return { logs, loading, error };
}
