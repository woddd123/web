import React, { useState, useCallback } from 'react';
import { Image as ImageIcon, Layers, PenTool, Wand2, BookOpen, Film } from 'lucide-react';
import clsx from 'clsx';
import ImageCompressor from './components/ImageCompressor';
import BackgroundRemover from './components/BackgroundRemover';
import GraphicDesigner from './components/GraphicDesigner';
import SmartPhotoEditor from './components/SmartPhotoEditor';
import CreativeWriter from './components/CreativeWriter';
import HistorySidebar from './components/HistorySidebar';
import Toast, { type ToastMessage } from './components/Toast';
import { type Task } from './api';

function App() {
  const [activeTab, setActiveTab] = useState<'compress' | 'remove-bg' | 'design' | 'photo' | 'writing'>('compress');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [refreshHistory, setRefreshHistory] = useState(0);
  const [compressorKey, setCompressorKey] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleSelectTask = (task: Task) => {
    setActiveTask(task);
    if (task.type === 'compress') {
      setActiveTab('compress');
    } else if (task.type === 'remove-bg' || task.type === 'video-remove-bg') {
      setActiveTab('remove-bg');
    } else if (task.type === 'writing') {
      setActiveTab('writing');
    }
  };

  const handleTaskUpdate = () => {
    setRefreshHistory(prev => prev + 1);
  };

  const handleNewTask = () => {
    setActiveTask(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Toast toasts={toasts} removeToast={removeToast} />
      <HistorySidebar 
        onSelectTask={handleSelectTask} 
        onNewTask={handleNewTask}
        refreshTrigger={refreshHistory} 
      />
      
      <div className="ml-64 p-8">
        <div className={clsx(
          "mx-auto transition-all duration-300",
          activeTab === 'photo' || activeTab === 'design' ? "max-w-[1600px]" : "max-w-4xl"
        )}>
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">YaSo 图片工具箱</h1>
            <p className="text-gray-600">一站式图片处理工具：智能压缩、AI 抠图</p>
          </header>

          {/* Tab Navigation */}
          <div className="flex justify-center mb-8">
            <div className="bg-white p-1 rounded-xl shadow-sm border border-gray-200 inline-flex">
              <button
                onClick={() => {
                  setActiveTab('compress');
                  setActiveTask(null); // Clear active task when switching manually
                }}
                className={clsx(
                  "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === 'compress' 
                    ? "bg-blue-600 text-white shadow-md" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <ImageIcon size={18} />
                图片压缩
              </button>
              <button
                onClick={() => {
                  setActiveTab('remove-bg');
                  setActiveTask(null);
                }}
                className={clsx(
                  "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === 'remove-bg' 
                    ? "bg-purple-600 text-white shadow-md" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Layers size={18} />
                智能抠图
              </button>
              <button
                onClick={() => {
                  setActiveTab('design');
                  setActiveTask(null);
                }}
                className={clsx(
                  "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === 'design' 
                    ? "bg-pink-600 text-white shadow-md" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <PenTool size={18} />
                图文设计
              </button>
              <button
                onClick={() => {
                  setActiveTab('photo');
                  setActiveTask(null);
                }}
                className={clsx(
                  "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === 'photo' 
                    ? "bg-indigo-600 text-white shadow-md" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Wand2 size={18} />
                智能P图
              </button>
              <button
                onClick={() => {
                  setActiveTab('writing');
                  setActiveTask(null);
                }}
                className={clsx(
                  "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === 'writing' 
                    ? "bg-teal-600 text-white shadow-md" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <BookOpen size={18} />
                文案创作
              </button>

            </div>
          </div>

          {/* Content Area */}
          <div className="transition-all duration-300">
            <div className={activeTab === 'compress' ? 'block' : 'hidden'}>
              <ImageCompressor 
                initialTask={activeTask?.type === 'compress' ? activeTask : undefined}
                onTaskUpdate={handleTaskUpdate}
                onComplete={(msg) => addToast(msg, 'success')}
              />
            </div>
            <div className={activeTab === 'remove-bg' ? 'block' : 'hidden'}>
              <BackgroundRemover 
                initialTask={activeTask?.type !== 'compress' ? activeTask : undefined}
                onTaskUpdate={handleTaskUpdate}
                onComplete={(msg) => addToast(msg, 'success')}
              />
            </div>
            <div className={activeTab === 'design' ? 'block' : 'hidden'}>
              <GraphicDesigner />
            </div>
            <div className={activeTab === 'photo' ? 'block' : 'hidden'}>
              <SmartPhotoEditor onShowToast={(msg, type) => addToast(msg, type)} />
            </div>
            <div className={activeTab === 'writing' ? 'block' : 'hidden'}>
              <CreativeWriter 
                initialTask={activeTask?.type === 'writing' ? activeTask : undefined}
                onTaskUpdate={handleTaskUpdate}
                onComplete={(msg) => addToast(msg, 'success')}
                onNew={handleNewTask}
              />
            </div>
          </div>
          
          <footer className="mt-12 text-center text-sm text-gray-400">
            <p>© {new Date().getFullYear()} YaSo Web Tool. All processing happens locally in your browser.</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
