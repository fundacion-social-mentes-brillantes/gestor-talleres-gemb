import React from 'react';
import { Task } from '../types';
import { isBefore, isToday, parseISO, startOfDay } from 'date-fns';
import { AlertCircle, Clock, CheckCircle2, PlayCircle } from 'lucide-react';

interface DashboardProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export function Dashboard({ tasks, onTaskClick }: DashboardProps) {
  const now = new Date();
  
  const pending = tasks.filter(t => t.status === 'pending');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const completed = tasks.filter(t => t.status === 'completed');
  
  const overdue = tasks.filter(t => {
    if (t.status === 'completed' || !t.dueDate) return false;
    return isBefore(parseISO(t.dueDate), startOfDay(now));
  });

  const dueToday = tasks.filter(t => {
    if (t.status === 'completed' || !t.dueDate) return false;
    return isToday(parseISO(t.dueDate));
  });

  const StatCard = ({ title, count, icon: Icon, colorClass }: any) => (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colorClass}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{count}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Resumen</h2>
        <p className="text-gray-500 mt-1">Un vistazo rápido a tu centro de control.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Pendientes" count={pending.length} icon={Clock} colorClass="bg-yellow-100 text-yellow-600" />
        <StatCard title="En Proceso" count={inProgress.length} icon={PlayCircle} colorClass="bg-blue-100 text-blue-600" />
        <StatCard title="Completados" count={completed.length} icon={CheckCircle2} colorClass="bg-green-100 text-green-600" />
        <StatCard title="Vencidos" count={overdue.length} icon={AlertCircle} colorClass="bg-red-100 text-red-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Vencidos */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-red-50">
            <h3 className="text-lg font-semibold text-red-800 flex items-center gap-2">
              <AlertCircle size={20} />
              Trabajos Vencidos
            </h3>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {overdue.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center">
                <div className="bg-green-50 p-3 rounded-full mb-3">
                  <CheckCircle2 size={24} className="text-green-500" />
                </div>
                <p className="text-gray-500 font-medium">No hay trabajos vencidos.</p>
                <p className="text-sm text-gray-400 mt-1">¡Excelente ritmo de trabajo!</p>
              </div>
            ) : (
              overdue.map(task => (
                <div 
                  key={task.id} 
                  onClick={() => onTaskClick(task)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <p className="font-medium text-gray-900">{task.title}</p>
                  <p className="text-sm text-red-600 mt-1">
                    Venció el {new Date(task.dueDate!).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Para Hoy */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
            <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
              <Clock size={20} />
              Para Hoy
            </h3>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {dueToday.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center">
                <div className="bg-gray-50 p-3 rounded-full mb-3">
                  <Clock size={24} className="text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">No hay trabajos para hoy.</p>
                <p className="text-sm text-gray-400 mt-1">Puedes relajarte o adelantar trabajo.</p>
              </div>
            ) : (
              dueToday.map(task => (
                <div 
                  key={task.id} 
                  onClick={() => onTaskClick(task)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <p className="font-medium text-gray-900">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                      task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                      task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {task.priority === 'urgent' ? 'Urgente' : 
                       task.priority === 'high' ? 'Alta' : 
                       task.priority === 'medium' ? 'Media' : 'Baja'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
