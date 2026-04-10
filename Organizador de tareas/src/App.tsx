import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { KanbanBoard } from './components/KanbanBoard';
import { Agenda } from './components/Agenda';
import { CompletedList } from './components/CompletedList';
import { TaskModal } from './components/TaskModal';
import { ActivityHistory } from './components/ActivityHistory';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTasks } from './hooks/useTasks';
import { useUsers } from './hooks/useUsers';
import { useActivityLogs } from './hooks/useActivityLogs';
import { Task } from './types';
import { AlertTriangle, Search, Filter, X } from 'lucide-react';

function AppContent() {
  const { user, loading } = useAuth();
  const { tasks, loading: tasksLoading, error: tasksError, addTask, updateTask, deleteTask } = useTasks();
  const { users, error: usersError } = useUsers();
  const { logs, loading: logsLoading } = useActivityLogs();
  
  const [currentView, setCurrentView] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTimeout, setIsTimeout] = useState(false);

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (loading || tasksLoading) {
      timer = setTimeout(() => setIsTimeout(true), 10000); // 10 seconds timeout
    }
    return () => clearTimeout(timer);
  }, [loading, tasksLoading]);

  if (tasksError || usersError) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-red-100 max-w-md w-full text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-4" size={48} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Error de conexión</h2>
          <p className="text-gray-600 mb-6 text-sm">
            {tasksError || usersError}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (loading || tasksLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        {isTimeout && (
          <div className="text-center max-w-md px-4">
            <p className="text-gray-600 mb-4">La carga está tardando más de lo esperado. Verifica tu conexión a internet o recarga la página.</p>
            <button onClick={() => window.location.reload()} className="text-blue-600 font-medium hover:underline">Recargar ahora</button>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const handleNewTask = () => {
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (taskData: any) => {
    if (selectedTask) {
      await updateTask(selectedTask.id, taskData);
    } else {
      await addTask(taskData);
    }
  };

  const handleTaskMove = async (taskId: string, newStatus: any) => {
    await updateTask(taskId, { status: newStatus });
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterAssignee('');
    setFilterPriority('');
    setFilterCategory('');
  };

  // Apply filters
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = searchTerm === '' || 
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (task.description && task.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesAssignee = filterAssignee === '' || task.assignees.includes(filterAssignee);
    const matchesPriority = filterPriority === '' || task.priority === filterPriority;
    const matchesCategory = filterCategory === '' || task.category === filterCategory;

    return matchesSearch && matchesAssignee && matchesPriority && matchesCategory;
  });

  // Extract unique categories for filter dropdown
  const categories = Array.from(new Set(tasks.map(t => t.category).filter(Boolean)));
  const activeFiltersCount = (filterAssignee ? 1 : 0) + (filterPriority ? 1 : 0) + (filterCategory ? 1 : 0);

  return (
    <Layout currentView={currentView} setCurrentView={setCurrentView} onNewTask={handleNewTask}>
      
      {/* Global Search & Filters Bar */}
      {currentView !== 'activity' && (
        <div className="mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                type="text" 
                placeholder="Buscar trabajos, notas..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center justify-center gap-2 px-4 py-2 border rounded-lg font-medium transition-colors ${
                showFilters || activeFiltersCount > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter size={20} />
              <span>Filtros {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
            </button>
          </div>

          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Usuario Asignado</label>
                <select 
                  value={filterAssignee} 
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todos los usuarios</option>
                  {users.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Prioridad</label>
                <select 
                  value={filterPriority} 
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todas las prioridades</option>
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Categoría</label>
                <select 
                  value={filterCategory} 
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todas las categorías</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              {activeFiltersCount > 0 && (
                <div className="sm:col-span-3 flex justify-end">
                  <button 
                    onClick={clearFilters}
                    className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  >
                    <X size={14} /> Limpiar filtros
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {currentView === 'dashboard' && <Dashboard tasks={filteredTasks} onTaskClick={handleTaskClick} />}
      {currentView === 'kanban' && <KanbanBoard tasks={filteredTasks} onTaskClick={handleTaskClick} onTaskMove={handleTaskMove} />}
      {currentView === 'agenda' && <Agenda tasks={filteredTasks} onTaskClick={handleTaskClick} />}
      {currentView === 'completed' && <CompletedList tasks={filteredTasks} onTaskClick={handleTaskClick} />}
      {currentView === 'activity' && <ActivityHistory logs={logs} users={users} tasks={tasks} />}

      {isModalOpen && (
        <TaskModal
          task={selectedTask}
          users={users}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveTask}
          onDelete={selectedTask ? deleteTask : undefined}
        />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
