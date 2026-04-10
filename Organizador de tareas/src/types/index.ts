export type Role = 'admin' | 'collaborator';
export type TaskStatus = 'pending' | 'in_progress' | 'on_hold' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: Role;
  createdAt: string;
}

export interface Subtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: string;
  assignees: string[];
  dueDate: string | null;
  category: string;
  tags: string[];
  subtasks: Subtask[];
  notes: string;
  links: string[];
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  taskId: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  taskId: string;
  userId: string;
  action: string;
  timestamp: string;
}
