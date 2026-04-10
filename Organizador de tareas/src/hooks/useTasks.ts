import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Task, TaskStatus } from '../types';
import { useAuth } from '../contexts/AuthContext';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Task[];
      setTasks(tasksData);
      setError(null);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      handleFirestoreError(err, OperationType.LIST, 'tasks');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const addTask = async (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'progress'>) => {
    if (!user) return;
    try {
      const newTaskRef = doc(collection(db, 'tasks'));
      const now = new Date().toISOString();
      const progress = taskData.subtasks.length > 0 
        ? Math.round((taskData.subtasks.filter(st => st.isCompleted).length / taskData.subtasks.length) * 100)
        : 0;

      const newTask: Task = {
        ...taskData,
        id: newTaskRef.id,
        progress,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(newTaskRef, newTask);
      
      // Log activity
      await logActivity(newTask.id, 'creó el trabajo');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tasks');
    }
  };

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    if (!user) return;
    try {
      const taskRef = doc(db, 'tasks', taskId);
      const now = new Date().toISOString();
      
      // Recalculate progress if subtasks are updated
      let progress = updates.progress;
      if (updates.subtasks) {
        progress = updates.subtasks.length > 0 
          ? Math.round((updates.subtasks.filter(st => st.isCompleted).length / updates.subtasks.length) * 100)
          : 0;
        updates.progress = progress;
      }

      await updateDoc(taskRef, {
        ...updates,
        updatedAt: now
      });

      if (updates.status) {
        await logActivity(taskId, `cambió el estado a ${updates.status}`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const logActivity = async (taskId: string, action: string) => {
    if (!user) return;
    try {
      const logRef = doc(collection(db, 'activity_logs'));
      await setDoc(logRef, {
        id: logRef.id,
        taskId,
        userId: user.uid,
        action,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error logging activity", error);
    }
  };

  return { tasks, loading, error, addTask, updateTask, deleteTask };
}
