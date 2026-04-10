import React, { useState, useEffect } from 'react';
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
    setSubtasks(subtasks.map(st => st.id === id ? { ...st, isCompleted: !st.isCompleted } : st));
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter(st => st.id !== id));
  };

  const toggleAssignee = (uid: string) => {
    if (assignees.includes(uid)) {
      setAssignees(assignees.filter(id => id !== uid));
    } else {
      setAssignees([...assignees, uid]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 md:p-4">
      <div className="bg-white md:rounded-xl shadow-xl w-full h-full md:h-auto md:max-h-[90vh] md:max-w-3xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 sticky top-0 bg-white z-10 md:rounded-t-xl">
          <h2 className="text-xl font-bold text-gray-900">
            {task ? 'Editar Trabajo' : 'Nuevo Trabajo'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          <form id="task-form" onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="Ej. Revisar diseño de la landing page"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En Proceso</option>
                  <option value="on_hold">En Espera</option>
                  <option value="completed">Completado</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prioridad</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Límite</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Asignar a</label>
                <div className="flex flex-wrap gap-2">
                  {users.map(u => (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => toggleAssignee(u.uid)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                        assignees.includes(u.uid) 
                          ? 'bg-blue-50 border-blue-200 text-blue-700' 
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <img 
                        src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} 
                        alt={u.displayName} 
                        className="w-5 h-5 rounded-full"
                      />
                      {u.displayName.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                placeholder="Detalles adicionales del trabajo..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Subtareas (Checklist)</label>
              <div className="space-y-2 mb-3">
                {subtasks.map(st => (
                  <div key={st.id} className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
                    <input
                      type="checkbox"
                      checked={st.isCompleted}
                      onChange={() => toggleSubtask(st.id)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
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
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSubtask())}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  placeholder="Añadir subtarea..."
                />
                <button
                  type="button"
                  onClick={handleAddSubtask}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Plus size={18} />
                  Añadir
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas Internas</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-yellow-50"
                placeholder="Notas privadas o comentarios..."
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-4 md:p-6 border-t border-gray-200 flex items-center justify-between bg-gray-50 sticky bottom-0 md:rounded-b-xl z-10">
          {task && onDelete ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('¿Estás seguro de eliminar este trabajo?')) {
                  onDelete(task.id);
                  onClose();
                }
              }}
              className="px-3 md:px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm md:text-base"
            >
              <Trash2 size={18} />
              <span className="hidden sm:inline">Eliminar</span>
            </button>
          ) : (
            <div></div>
          )}
          
          <div className="flex gap-2 md:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 md:px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors text-sm md:text-base"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="task-form"
              disabled={isSubmitting}
              className="px-4 md:px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm md:text-base whitespace-nowrap"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
