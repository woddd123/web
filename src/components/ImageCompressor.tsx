import React, { useState, useCallback, useEffect, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { Upload, Download, RefreshCw, X, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import { formatSize } from '../utils';
import { api, type Task } from '../api';

interface CompressedImage {
  id: string;
  originalFile: File;
  compressedFile: File;
  originalUrl: string;
  compressedUrl: string;
  isCompressing: boolean;
  taskId?: number;
}

interface Props {
  initialTask?: Task | null;
  onTaskUpdate?: () => void;
  onComplete?: (message: string) => void;
}

// Global state to persist task progress across task switches
const taskStateStore: Record<number, CompressedImage[]> = {};
const taskListeners: Record<number, ((images: CompressedImage[]) => void)[]> = {};

const updateTaskStore = (taskId: number, images: CompressedImage[]) => {
  taskStateStore[taskId] = images;
  if (taskListeners[taskId]) {
    taskListeners[taskId].forEach(listener => listener(images));
  }
};

const subscribeToTask = (taskId: number, listener: (images: CompressedImage[]) => void) => {
  if (!taskListeners[taskId]) taskListeners[taskId] = [];
  taskListeners[taskId].push(listener);
  return () => {
    taskListeners[taskId] = taskListeners[taskId].filter(l => l !== listener);
  };
};

const ImageCompressor: React.FC<Props> = ({ initialTask, onTaskUpdate, onComplete }) => {
  const [images, setImages] = useState<CompressedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [quality, setQuality] = useState(0.8);
  const [maxWidth, setMaxWidth] = useState(1920);
  const loadRequestIdRef = useRef(0);
  const processingRef = useRef(false);

  // Sync with global store when task changes or store updates
  useEffect(() => {
    if (initialTask?.id) {
      // Check if we have state in store
      if (taskStateStore[initialTask.id]) {
        setImages(taskStateStore[initialTask.id]);
      } else {
        // If switching to a task that doesn't have local state yet, clear images first
        setImages([]); 
      }

      // Subscribe to updates for this task
      const unsubscribe = subscribeToTask(initialTask.id, (newImages) => {
        setImages(newImages);
      });
      return unsubscribe;
    } else {
      // New task mode
      setImages([]);
    }
  }, [initialTask?.id]);

  // Load initial task data from API if not in store
  useEffect(() => {
    if (initialTask && initialTask.type === 'compress' && !taskStateStore[initialTask.id]) {
      const currentRequestId = ++loadRequestIdRef.current;
      
      const loadTask = async () => {
        try {
          // Always load original file for re-compression capability
          const res = await fetch(api.getFileUrl(initialTask.original_file_path));
          const blob = await res.blob();
          
          if (currentRequestId !== loadRequestIdRef.current) return;

          const file = new File([blob], initialTask.original_filename, { type: blob.type });
          const originalUrl = URL.createObjectURL(file);

          // If task is completed and has a processed file, load it directly
          if (initialTask.status === 'completed' && initialTask.processed_file_path) {
            const resProcessed = await fetch(api.getFileUrl(initialTask.processed_file_path));
            const blobProcessed = await resProcessed.blob();
            
            if (currentRequestId !== loadRequestIdRef.current) return;

            const processedFile = new File([blobProcessed], `compressed-${initialTask.original_filename}`, { type: blobProcessed.type });
            const compressedUrl = URL.createObjectURL(processedFile);

            const loadedImages = [{
              id: initialTask.id.toString(),
              originalFile: file,
              compressedFile: processedFile,
              originalUrl,
              compressedUrl,
              isCompressing: false,
              taskId: initialTask.id
            }];
            
            setImages(loadedImages);
            updateTaskStore(initialTask.id, loadedImages);
          } else {
            // Otherwise start processing it
            if (currentRequestId === loadRequestIdRef.current) {
               // We don't await this, it runs in background
               processFiles([file], initialTask.id);
            }
          }
        } catch (e) {
          console.error("Failed to load task file", e);
        }
      };
      loadTask();
    }
  }, [initialTask]);

  const handleCompression = async (file: File, q: number, w: number) => {
    try {
      const options = {
        maxSizeMB: 1, 
        maxWidthOrHeight: w,
        useWebWorker: true,
        initialQuality: q,
      };
      
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error(error);
      return file; 
    }
  };

  const processFiles = async (files: File[], existingTaskId?: number) => {
    const validFiles = files.filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    // Initialize state placeholders
    const newItems = validFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      originalFile: file,
      compressedFile: file, 
      originalUrl: URL.createObjectURL(file),
      compressedUrl: '',
      isCompressing: true,
      taskId: existingTaskId
    }));

    // If we are working on an existing task, merge with current state in store
    let currentImages = existingTaskId ? (taskStateStore[existingTaskId] || []) : [];
    
    // If re-processing existing single file task, replace it. Otherwise append.
    if (existingTaskId && currentImages.length > 0) {
       currentImages = newItems; // Reset for re-compression
    } else {
       currentImages = [...currentImages, ...newItems];
    }

    // Initial UI update
    if (existingTaskId) {
        updateTaskStore(existingTaskId, currentImages);
    } else {
        // For new tasks (no ID yet), we update local state only first
        setImages(prev => [...prev, ...newItems]);
    }

    // Process each file
    // We clone the array to iterate, but we need to reference latest state for updates
    for (const imgState of newItems) {
        
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 100));

        let taskId = imgState.taskId;
        
        // Create task if needed (first file in a new batch)
        if (!taskId) {
            try {
                const newTask = await api.createTask('compress', imgState.originalFile);
                taskId = newTask.id;
                
                // Now we have a Task ID, we can start using the global store
                // Move local state to global store
                // We need to find the current local images and attach taskId to them
                setImages(prev => {
                    const updated = prev.map(img => img.id === imgState.id ? { ...img, taskId: newTask.id } : img);
                    // Also initialize store with this
                    updateTaskStore(newTask.id, updated.filter(img => img.taskId === newTask.id));
                    return updated;
                });
                
                if (onTaskUpdate) onTaskUpdate();
            } catch (e) {
                console.error("Failed to create task", e);
                continue; 
            }
        }

        // Compress
        const compressed = await handleCompression(imgState.originalFile, quality, maxWidth);
        
        // Yield again
        await new Promise(resolve => setTimeout(resolve, 50));

        const compressedUrl = URL.createObjectURL(compressed);

        // Update Store
        if (taskId) {
            const currentStoreImages = taskStateStore[taskId] || [];
            const updatedStoreImages = currentStoreImages.map(img => 
                img.id === imgState.id ? {
                    ...img,
                    compressedFile: compressed,
                    compressedUrl,
                    isCompressing: false,
                    taskId
                } : img
            );
            updateTaskStore(taskId, updatedStoreImages);
            
            // If this was a new task and we are still viewing "New Task" page (activeTask is null),
            // we might want to switch view? Or just keep local state in sync?
            // The `setImages` listener handles store updates if we are subscribed.
            // But if we just created the task, we might not be subscribed yet because initialTask prop hasn't changed.
            // However, for new tasks flow, user stays on "New Task" screen until they click history.
            // So we also need to update local state if we are still on the "same" logical context.
            
            // Actually, best UX: if user uploads file, it becomes a task.
            // We should probably auto-select that task? 
            // For now, let's just keep local state updated if the taskId matches what we just created.
        }

        // Update API
        if (taskId && !existingTaskId) {
            api.updateTask(taskId, 'completed', compressed).then(() => {
                if (validFiles.length === 1 && onComplete) onComplete('图片压缩任务已完成');
                if (onTaskUpdate) onTaskUpdate();
            }).catch(console.error);
        }
    }
    
    if (validFiles.length > 1 && onComplete) {
        onComplete(`${validFiles.length} 张图片压缩任务已完成`);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processFiles(files, initialTask?.id);
    }
  }, [initialTask?.id, quality, maxWidth]);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files), initialTask?.id);
    }
  };

  // Re-compress when settings change
  // We need to debounce this and handle it carefully with global store
  useEffect(() => {
      if (images.length === 0 || !initialTask?.id) return;
      
      // Only trigger if settings changed significantly and we have images
      // And avoid infinite loops or conflicts with initial load
      // This part is tricky with global store. 
      // Let's simplify: Only re-compress if user explicitly asks or we debounce heavily.
      
      const timer = setTimeout(async () => {
          // Check if current settings differ from what might be stored? 
          // For now, let's just re-run processFiles logic for existing images but with new settings
          
          const imagesToRecompress = images.filter(img => !img.isCompressing);
          if (imagesToRecompress.length === 0) return;

          // Mark as compressing in store
          const taskId = initialTask.id;
          const currentStoreImages = taskStateStore[taskId] || images;
          
          const compressingImages = currentStoreImages.map(img => ({ ...img, isCompressing: true }));
          updateTaskStore(taskId, compressingImages);

          for (const img of compressingImages) {
              await new Promise(r => setTimeout(r, 100));
              
              // Check if task still exists in store (hasn't been cleared)
              if (!taskStateStore[taskId]) break;

              try {
                  const compressed = await handleCompression(img.originalFile, quality, maxWidth);
                  const compressedUrl = URL.createObjectURL(compressed);
                  
                  // Update single item in store
                  const latestImages = taskStateStore[taskId] || [];
                  const updatedImages = latestImages.map(i => i.id === img.id ? {
                      ...i,
                      compressedFile: compressed,
                      compressedUrl,
                      isCompressing: false
                  } : i);
                  
                  updateTaskStore(taskId, updatedImages);
              } catch (e) {
                  console.error(e);
              }
          }
      }, 500);
      return () => clearTimeout(timer);
  }, [quality, maxWidth]); // Removed images from dependency to avoid loop, rely on initialTask context

  const downloadImage = (img: CompressedImage) => {
    const link = document.createElement('a');
    link.href = img.compressedUrl;
    link.download = `compressed-${img.originalFile.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setImages([]);
    if (initialTask?.id) {
        updateTaskStore(initialTask.id, []);
    }
  };

  const removeImage = (id: string) => {
    if (initialTask?.id) {
        const current = taskStateStore[initialTask.id] || [];
        updateTaskStore(initialTask.id, current.filter(img => img.id !== id));
    } else {
        setImages(prev => prev.filter(img => img.id !== id));
    }
  };

  return (
    <div className="w-full">
      {images.length === 0 ? (
        <div
          className={clsx(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50",
            "bg-white shadow-sm"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => document.getElementById('compress-input')?.click()}
        >
          <input
            type="file"
            id="compress-input"
            className="hidden"
            accept="image/*"
            multiple
            onChange={onFileSelect}
          />
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-blue-100 rounded-full text-blue-600">
              <Upload size={32} />
            </div>
            <div>
              <p className="text-xl font-medium text-gray-700">点击或拖拽图片到此处</p>
              <p className="text-sm text-gray-500 mt-1">支持 JPG, PNG, WebP 等常见格式</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Toolbar */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button 
                onClick={reset}
                className="p-2 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                title="重新上传"
              >
                <X size={20} />
              </button>
              {images.length === 1 ? (
                <span className="font-medium text-gray-700 truncate max-w-[200px]">
                  {images[0].originalFile.name}
                </span>
              ) : (
                 <span className="font-medium text-gray-700">
                   已选择 {images.length} 张图片
                 </span>
              )}
            </div>
            
            <div className="flex items-center gap-6">
               <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-medium">压缩质量: {Math.round(quality * 100)}%</label>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1" 
                    step="0.1" 
                    value={quality}
                    onChange={(e) => setQuality(parseFloat(e.target.value))}
                    className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
               </div>
               <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-medium">最大宽度: {maxWidth}px</label>
                   <select 
                    value={maxWidth}
                    onChange={(e) => setMaxWidth(parseInt(e.target.value))}
                    className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 bg-white border px-2 py-1"
                  >
                    <option value="1280">1280px</option>
                    <option value="1920">1920px</option>
                    <option value="2560">2560px</option>
                    <option value="3840">的原图 (不限制)</option>
                  </select>
               </div>
            </div>

            {images.length === 1 && (
                <button
                onClick={() => downloadImage(images[0])}
                disabled={images[0].isCompressing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                <Download size={18} />
                下载
                </button>
            )}
          </div>

          {/* Content Area */}
          {images.length === 1 ? (
              // Single Image View
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                {/* Original */}
                <div className="p-6 flex flex-col items-center gap-4">
                  <div className="text-center">
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">原始图片</span>
                    <p className="text-lg font-bold text-gray-800">{formatSize(images[0].originalFile.size)}</p>
                  </div>
                  <div className="relative group w-full aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center border border-gray-200">
                    <img 
                      src={images[0].originalUrl} 
                      alt="Original" 
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </div>

                {/* Compressed */}
                <div className="p-6 flex flex-col items-center gap-4">
                  <div className="text-center">
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">压缩后</span>
                    {images[0].isCompressing ? (
                      <div className="h-7 flex items-center gap-2 text-blue-600">
                        <RefreshCw className="animate-spin" size={16} />
                        <span className="text-sm">处理中...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold text-gray-800">{formatSize(images[0].compressedFile.size)}</p>
                        <span className="text-sm text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                          -{Math.round((1 - images[0].compressedFile.size / images[0].originalFile.size) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="relative group w-full aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center border border-gray-200">
                    {images[0].isCompressing ? (
                       <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                       </div>
                    ) : null}
                    <img 
                      src={images[0].compressedUrl || images[0].originalUrl} 
                      alt="Compressed" 
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </div>
              </div>
          ) : (
              // Multi Image List View
              <div className="p-4 overflow-x-auto">
                 <table className="w-full min-w-[600px]">
                    <thead>
                        <tr className="border-b border-gray-200 text-left text-sm font-medium text-gray-500">
                            <th className="pb-3 pl-2">预览</th>
                            <th className="pb-3">文件名</th>
                            <th className="pb-3">原始大小</th>
                            <th className="pb-3">压缩后大小</th>
                            <th className="pb-3">压缩率</th>
                            <th className="pb-3 text-right pr-2">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {images.map((img) => (
                            <tr key={img.id} className="group hover:bg-gray-50 transition-colors">
                                <td className="py-3 pl-2">
                                    <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center">
                                        <img src={img.compressedUrl || img.originalUrl} className="max-w-full max-h-full object-cover" />
                                    </div>
                                </td>
                                <td className="py-3 max-w-[200px] truncate" title={img.originalFile.name}>
                                    <span className="text-gray-800 font-medium">{img.originalFile.name}</span>
                                </td>
                                <td className="py-3 text-gray-600 text-sm">
                                    {formatSize(img.originalFile.size)}
                                </td>
                                <td className="py-3 text-gray-600 text-sm">
                                    {img.isCompressing ? (
                                        <span className="flex items-center gap-1 text-blue-600">
                                            <RefreshCw size={12} className="animate-spin" /> 处理中
                                        </span>
                                    ) : (
                                        formatSize(img.compressedFile.size)
                                    )}
                                </td>
                                <td className="py-3">
                                     {!img.isCompressing && (
                                        <span className="text-green-600 text-sm font-medium bg-green-50 px-2 py-0.5 rounded-full">
                                            -{Math.round((1 - img.compressedFile.size / img.originalFile.size) * 100)}%
                                        </span>
                                     )}
                                </td>
                                <td className="py-3 text-right pr-2">
                                    <div className="flex items-center justify-end gap-2">
                                        <button 
                                            onClick={() => downloadImage(img)}
                                            disabled={img.isCompressing}
                                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="下载"
                                        >
                                            <Download size={18} />
                                        </button>
                                        <button 
                                            onClick={() => removeImage(img.id)}
                                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                            title="移除"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                 </table>
              </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageCompressor;
