import React from 'react';
import { Task } from '../types';
import { isToday, isThisWeek, isBefore, startOfDay, parseISO } from 'date-fns';
import { Clock, CheckSquare } from 'lucide-react';

interface AgendaProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export function Agenda({ tasks, onTaskClick }: AgendaProps) {
  const now = new Date();
  
  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.dueDate);

  const overdue = activeTasks.filter(t => isBefore(parseISO(t.dueDate!), startOfDay(now)));
  const today = activeTasks.filter(t => isToday(parseISO(t.dueDate!)));
  const thisWeek = activeTasks.filter(t => isThisWeek(parseISO(t.dueDate!)) && !isToday(parseISO(t.dueDate!)) && !isBefore(parseISO(t.dueDate!), startOfDay(now)));
  const later = activeTasks.filter(t => !isThisWeek(parseISO(t.dueDate!)) && !isBefore(parseISO(t.dueDate!), startOfDay(now)));

  const TaskRow: React.FC<{ task: Task }> = ({ task }) => (
    <div 
      onClick={() => onTaskClick(task)}
      className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all mb-3"
    >
      <div className="flex items-center gap-4">
        <div className={`w-2 h-10 rounded-full ${
          task.priority === 'urgent' ? 'bg-red-500' :
          task.priority === 'high' ? 'bg-orange-500' :
          task.priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-300'
        }`} />
        <div>
          <h4 className="font-medium text-gray-900">{task.title}</h4>
          <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {new Date(task.dueDate!).toLocaleDateString()}
            </span>
            {task.subtasks?.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckSquare size={12} />
                {task.subtasks.filter(st => st.isCompleted).length}/{task.subtasks.length}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
          task.status === 'pending' ? 'bg-gray-100 text-gray-700' :
          task.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
          task.status === 'on_hold' ? 'bg-yellow-100 text-yellow-700' :
          'bg-green-100 text-green-700'
        }`}>
          {task.status === 'pending' ? 'Pendiente' : 
           task.status === 'in_progress' ? 'En Proceso' : 
           task.status === 'on_hold' ? 'En Espera' : 'Completado'}
        </span>
      </div>
    </div>
  );

  const Section = ({ title, tasks, color }: { title: string, tasks: Task[], color: string }) => {
    if (tasks.length === 0) return null;
    return (
      <div className="mb-8">
        <h3 className={`text-lg font-bold mb-4 ${color}`}>{title}</h3>
        <div>
          {tasks.map(task => <TaskRow key={task.id} task={task} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Agenda</h2>
        <p className="text-gray-500 mt-1">Tus trabajos organizados por fecha de vencimiento.</p>
      </div>

      {activeTasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No tienes trabajos con fecha límite asignada.</p>
        </div>
      ) : (
        <>
          <Section title="Vencidos" tasks={overdue} color="text-red-600" />
          <Section title="Para Hoy" tasks={today} color="text-blue-600" />
          <Section title="Esta Semana" tasks={thisWeek} color="text-gray-900" />
          <Section title="Más Adelante" tasks={later} color="text-gray-500" />
        </>
      )}
    </div>
  );
}
