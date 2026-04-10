import React from 'react';
import { Task } from '../types';
import { CheckCircle2, Clock } from 'lucide-react';

interface CompletedListProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export function CompletedList({ tasks, onTaskClick }: CompletedListProps) {
  const completedTasks = tasks.filter(t => t.status === 'completed')
                              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Trabajos Completados</h2>
        <p className="text-gray-500 mt-1">Historial de todo lo que has terminado.</p>
      </div>

      {completedTasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <CheckCircle2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Aún no hay trabajos completados.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {completedTasks.map(task => (
              <div 
                key={task.id} 
                onClick={() => onTaskClick(task)}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <CheckCircle2 className="text-green-500" size={24} />
                  <div>
                    <h4 className="font-medium text-gray-900 line-through opacity-70">{task.title}</h4>
                    <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        Completado el {new Date(task.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
