import React, { useEffect, useRef, useState } from 'react';
import { Task, TaskPriority, TaskStatus, User } from '../types';
import { X, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface TaskModalProps {
  task?: Task | null;
  users: User[];
  onClose: () => void;
  onSave: (taskData: any) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
}

function scrollFieldIntoView(target: HTMLElement | null) {
  if (!target || typeof window === 'undefined') return;

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

export function TaskModal({ task, users, onClose, onSave, onDelete }: TaskModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'pending');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority || 'medium');
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.split('T')[0] : '');
  const [assignees, setAssignees] = useState<string[]>(task?.assignees || []);
  const [subtasks, setSubtasks] = useState(task?.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [notes, setNotes] = useState(task?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!task) {
      scrollFieldIntoView(titleInputRef.current);
    }
  }, [task]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      const taskData = {
        title,
        description,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        assignees,
        subtasks,
        notes,
        category: task?.category || 'General',
        tags: task?.tags || [],
        links: task?.links || [],
        createdBy: task?.createdBy || user?.uid,
      };

      await onSave(taskData);
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddSubtask = () => {
    if (!newSubtask.trim()) return;
    setSubtasks([...subtasks, { id: Date.now().toString(), title: newSubtask, isCompleted: false }]);
    setNewSubtask('');
  };

  const toggleSubtask = (id: string) => {
    setSubtasks(subtasks.map((st) => st.id === id ? { ...st, isCompleted: !st.isCompleted } : st));
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  const toggleAssignee = (uid: string) => {
    if (assignees.includes(uid)) {
      setAssignees(assignees.filter((id) => id !== uid));
    } else {
      setAssignees([...assignees, uid]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 md:p-4">
      <div className="flex h-[100dvh] items-stretch justify-center md:h-auto md:items-center">
        <div className="flex h-[100dvh] w-full flex-col bg-white shadow-xl md:h-auto md:max-h-[90dvh] md:max-w-3xl md:rounded-xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4 md:rounded-t-xl md:px-6 md:py-6">
            <h2 className="text-xl font-bold text-gray-900">
              {task ? 'Editar Trabajo' : 'Nuevo Trabajo'}
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 transition-colors hover:text-gray-600">
              <X size={24} />
            </button>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6"
            style={{
              scrollPaddingTop: 'calc(5.5rem + env(safe-area-inset-top, 0px))',
              scrollPaddingBottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <form id="task-form" onSubmit={handleSubmit} className="space-y-6 pb-24 md:pb-0">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Titulo</label>
                <input
                  ref={titleInputRef}
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej. Revisar diseno de la landing page"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Estado</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="pending">Pendiente</option>
                    <option value="in_progress">En Proceso</option>
                    <option value="on_hold">En Espera</option>
                    <option value="completed">Completado</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Prioridad</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Fecha Limite</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Asignar a</label>
                  <div className="flex flex-wrap gap-2">
                    {users.map((u) => (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => toggleAssignee(u.uid)}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          assignees.includes(u.uid)
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <img
                          src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`}
                          alt={u.displayName}
                          className="h-5 w-5 rounded-full"
                        />
                        {u.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descripcion</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  placeholder="Detalles adicionales del trabajo..."
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Subtareas (Checklist)</label>
                <div className="mb-3 space-y-2">
                  {subtasks.map((st) => (
                    <div key={st.id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={st.isCompleted}
                        onChange={() => toggleSubtask(st.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={`flex-1 text-sm ${st.isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {st.title}
                      </span>
                      <button type="button" onClick={() => removeSubtask(st.id)} className="text-gray-400 hover:text-red-500">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSubtask())}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    placeholder="Anadir subtarea..."
                  />
                  <button
                    type="button"
                    onClick={handleAddSubtask}
                    className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200"
                  >
                    <Plus size={18} />
                    Anadir
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Notas Internas</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 bg-yellow-50 px-4 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  placeholder="Notas privadas o comentarios..."
                />
              </div>
            </form>
          </div>

          <div
            className="z-10 border-t border-gray-200 bg-gray-50 px-4 py-4 md:rounded-b-xl md:px-6 md:py-6"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex items-center justify-between gap-3">
              {task && onDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Estas seguro de eliminar este trabajo?')) {
                      onDelete(task.id);
                      onClose();
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 md:px-4 md:text-base"
                >
                  <Trash2 size={18} />
                  <span className="hidden sm:inline">Eliminar</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex gap-2 md:gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 md:px-4 md:text-base"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="task-form"
                  disabled={isSubmitting}
                  className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 md:px-6 md:text-base"
                >
                  {isSubmitting ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
