import React, { useEffect, useState, useRef } from 'react';
import { Clock, Image, Video, FileImage, CheckCircle, XCircle, Loader2, Trash2, Plus, BookOpen } from 'lucide-react';
import { api, type Task } from '../api';
import clsx from 'clsx';

interface HistorySidebarProps {
  onSelectTask: (task: Task) => void;
  onNewTask: () => void;
  refreshTrigger: number; // Increment to trigger refresh
}

const SwipeableTaskItem = ({ 
  task, 
  onSelect, 
  onDelete,
  getIcon,
  getStatusIcon 
}: {
  task: Task;
  onSelect: (task: Task) => void;
  onDelete: (id: number) => void;
  getIcon: (type: string) => React.ReactNode;
  getStatusIcon: (status: string) => React.ReactNode;
}) => {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startOffsetRef = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only handle left click or touch
    if (e.button !== 0) return;
    startX.current = e.clientX;
    startOffsetRef.current = offset;
    isDragging.current = false;
    ref.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return;
    
    const diff = e.clientX - startX.current;
    
    // Determine if we are dragging horizontally
    if (Math.abs(diff) > 5) {
        isDragging.current = true;
    }

    // Limit drag: max 0 (closed), min -60 (open)
    // We add resistance or just hard limit? Hard limit for simplicity.
    const newOffset = Math.min(0, Math.max(-60, startOffsetRef.current + diff));
    setOffset(newOffset);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    ref.current?.releasePointerCapture(e.pointerId);
    
    // Snap logic
    if (offset < -30) {
      setOffset(-60);
    } else {
      setOffset(0);
    }
    
    // If it was a click (not a drag), we handle it in onClick
    // But we need to distinguish click from drag release.
    // We use isDragging ref.
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    // If open, close it
    if (offset === -60) {
        setOffset(0);
        return;
    }
    
    onSelect(task);
  };

  return (
    <div className="relative overflow-hidden rounded-lg mb-2 select-none touch-pan-y group">
      {/* Background (Delete Button) */}
      <div className="absolute inset-0 flex justify-end items-center bg-red-500 rounded-lg pr-4 cursor-pointer"
           onClick={(e) => {
             e.stopPropagation();
             onDelete(task.id);
           }}>
        <Trash2 className="text-white" size={18} />
      </div>
      
      {/* Foreground (Task Content) */}
      <div 
        ref={ref}
        className="bg-white p-3 rounded-lg border border-transparent hover:border-gray-200 transition-transform relative z-10 cursor-pointer shadow-sm"
        style={{ transform: `translateX(${offset}px)`, transition: isDragging.current ? 'none' : 'transform 0.2s ease-out' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
            {getIcon(task.type)}
            <span className="truncate max-w-[120px]">
              {task.type === 'compress' ? '图片压缩' : 
               task.type === 'remove-bg' ? '图片抠图' : 
               task.type === 'writing' ? '文案创作' : '视频抠图'}
            </span>
          </div>
          {getStatusIcon(task.status)}
        </div>
        <div className="text-xs text-gray-500 truncate" title={task.original_filename}>
          {task.original_filename}
        </div>
        <div className="text-[10px] text-gray-400 mt-1">
          {new Date(task.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
};

const HistorySidebar: React.FC<HistorySidebarProps> = ({ onSelectTask, onNewTask, refreshTrigger }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const data = await api.getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [refreshTrigger]);

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    try {
        await api.deleteTask(id);
        fetchTasks(); // Refresh list
    } catch (e) {
        console.error("Failed to delete task", e);
        alert("删除失败");
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'compress': return <FileImage size={16} />;
      case 'remove-bg': return <Image size={16} />;
      case 'video-remove-bg': return <Video size={16} />;
      case 'writing': return <BookOpen size={16} />;
      default: return <FileImage size={16} />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={14} className="text-green-500" />;
      case 'failed': return <XCircle size={14} className="text-red-500" />;
      case 'processing': return <Loader2 size={14} className="text-blue-500 animate-spin" />;
      default: return <Clock size={14} className="text-gray-400" />;
    }
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col fixed left-0 top-0 z-20">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Clock className="text-purple-600" />
            <h2 className="font-bold text-gray-800">历史任务</h2>
        </div>
        <button 
            onClick={onNewTask}
            className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
            title="新建任务"
        >
            <Plus size={18} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center py-8 text-gray-400">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">暂无历史记录</div>
        ) : (
          tasks.map(task => (
            <SwipeableTaskItem 
                key={task.id} 
                task={task} 
                onSelect={onSelectTask} 
                onDelete={handleDelete}
                getIcon={getIcon}
                getStatusIcon={getStatusIcon}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default HistorySidebar;
