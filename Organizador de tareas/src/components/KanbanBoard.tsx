import React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Task, TaskStatus } from '../types';
import { Clock, MessageSquare, CheckSquare } from 'lucide-react';

interface KanbanBoardProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onTaskMove: (taskId: string, newStatus: TaskStatus) => void;
}

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'pending', title: 'Pendiente', color: 'bg-gray-100' },
  { id: 'in_progress', title: 'En Proceso', color: 'bg-blue-50' },
  { id: 'on_hold', title: 'En Espera', color: 'bg-yellow-50' },
  { id: 'completed', title: 'Completado', color: 'bg-green-50' },
];

export function KanbanBoard({ tasks, onTaskClick, onTaskMove }: KanbanBoardProps) {
  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    onTaskMove(draggableId, destination.droppableId as TaskStatus);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Tablero Kanban</h2>
        <p className="text-gray-500 mt-1">Arrastra y suelta los trabajos para cambiar su estado.</p>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 flex gap-6 overflow-x-auto pb-4">
          {COLUMNS.map(column => {
            const columnTasks = tasks.filter(t => t.status === column.id);

            return (
              <div key={column.id} className={`flex-shrink-0 w-80 rounded-xl flex flex-col ${column.color}`}>
                <div className="p-4 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700">{column.title}</h3>
                  <span className="bg-white text-gray-600 text-xs font-bold px-2 py-1 rounded-full shadow-sm">
                    {columnTasks.length}
                  </span>
                </div>

                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 p-4 pt-0 space-y-3 overflow-y-auto transition-colors ${
                        snapshot.isDraggingOver ? 'bg-black/5' : ''
                      }`}
                    >
                      {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                        <div className="text-center p-4 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">
                          Sin trabajos
                        </div>
                      )}
                      {columnTasks.map((task, index) => (
                        // @ts-expect-error React 19 typing issue with hello-pangea/dnd
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              onClick={() => onTaskClick(task)}
                              className={`bg-white p-4 rounded-lg shadow-sm border border-gray-200 cursor-pointer hover:shadow-md transition-shadow ${
                                snapshot.isDragging ? 'shadow-lg ring-2 ring-blue-500' : ''
                              }`}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                  task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                  task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                  task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {task.priority === 'urgent' ? 'Urgente' : 
                                   task.priority === 'high' ? 'Alta' : 
                                   task.priority === 'medium' ? 'Media' : 'Baja'}
                                </span>
                                {task.dueDate && (
                                  <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <Clock size={12} />
                                    {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </div>
                              
                              <h4 className="font-medium text-gray-900 mb-2 line-clamp-2">{task.title}</h4>
                              
                              <div className="flex items-center gap-4 text-gray-400 text-xs mt-4">
                                {task.subtasks?.length > 0 && (
                                  <div className="flex items-center gap-1" title="Subtareas">
                                    <CheckSquare size={14} />
                                    <span>{task.subtasks.filter(st => st.isCompleted).length}/{task.subtasks.length}</span>
                                  </div>
                                )}
                                {task.notes && (
                                  <div className="flex items-center gap-1" title="Tiene notas">
                                    <MessageSquare size={14} />
                                  </div>
                                )}
                                
                                {/* Progress bar */}
                                {task.subtasks?.length > 0 && (
                                  <div className="flex-1 ml-2">
                                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-blue-500 rounded-full transition-all"
                                        style={{ width: `${task.progress}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
