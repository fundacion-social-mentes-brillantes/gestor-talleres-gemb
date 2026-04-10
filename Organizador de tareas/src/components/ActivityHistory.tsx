import React from 'react';
import { ActivityLog, User, Task } from '../types';
import { Clock, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  logs: ActivityLog[];
  users: User[];
  tasks: Task[];
}

export function ActivityHistory({ logs, users, tasks }: Props) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Activity className="text-blue-600" />
          Historial de Actividad
        </h2>
        <p className="text-gray-500 mt-1">Registro de todas las acciones del equipo en tiempo real.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {logs.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <div className="bg-gray-50 p-4 rounded-full mb-4">
              <Activity size={32} className="text-gray-400" />
            </div>
            <p className="text-gray-500 font-medium">No hay actividad reciente.</p>
            <p className="text-sm text-gray-400 mt-1">Las acciones de tu equipo aparecerán aquí.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map(log => {
              const user = users.find(u => u.uid === log.userId);
              const task = tasks.find(t => t.id === log.taskId);
              
              return (
                <div key={log.id} className="p-4 sm:p-5 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                  <img 
                    src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName || 'U'}`} 
                    alt={user?.displayName}
                    className="w-10 h-10 rounded-full border border-gray-200 mt-0.5" 
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 leading-relaxed">
                      <span className="font-semibold">{user?.displayName || 'Usuario desconocido'}</span>
                      {' '}{log.action}{' '}
                      <span className="font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                        {task?.title || 'un trabajo eliminado'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1.5">
                      <Clock size={12} />
                      {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
