import React, { useState, useCallback } from 'react';
import { removeBackground, type Config } from '@imgly/background-removal';
import { Download, RefreshCw, X, Layers, PenTool, Undo, Save, ZoomIn, ZoomOut, Maximize, Scan } from 'lucide-react';
import clsx from 'clsx';
import { formatSize } from '../utils';

import { api, type Task } from '../api';

interface ProcessedImage {
  originalFile: File;
  processedBlob: Blob;
  originalUrl: string;
  processedUrl: string;
  isProcessing: boolean;
  progress: number;
  statusText: string;
  taskId?: number;
}

interface Props {
  initialTask?: Task | null;
  onTaskUpdate?: () => void;
  onComplete?: (message: string) => void;
}

const ImageBackgroundRemover: React.FC<Props> = ({ initialTask, onTaskUpdate, onComplete }) => {
  const [image, setImage] = useState<ProcessedImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Editor state
  const [tool, setTool] = useState<'none' | 'lasso'>('none');
  const [history, setHistory] = useState<Blob[]>([]);
  const [currentPath, setCurrentPath] = useState<{x: number, y: number}[]>([]);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  
  const imageRef = React.useRef<HTMLImageElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const prevTaskIdRef = React.useRef<number | undefined>(undefined);

  // Load initial task
  React.useEffect(() => {
    // Check if we switched from a task to no task (reset)
    if (prevTaskIdRef.current && !initialTask) {
      setImage(null);
      setHistory([]);
      setTool('none');
    }
    
    // Update ref
    prevTaskIdRef.current = initialTask?.id;

    if (initialTask && initialTask.type === 'remove-bg') {
      const loadTask = async () => {
        try {
          // Always load original file
          const res = await fetch(api.getFileUrl(initialTask.original_file_path));
          const blob = await res.blob();
          const file = new File([blob], initialTask.original_filename, { type: blob.type });
          const originalUrl = URL.createObjectURL(file);

          // If task is completed and has a processed file, load it directly
          if (initialTask.status === 'completed' && initialTask.processed_file_path) {
            const resProcessed = await fetch(api.getFileUrl(initialTask.processed_file_path));
            const blobProcessed = await resProcessed.blob();
            const processedUrl = URL.createObjectURL(blobProcessed);

            setImage({
              originalFile: file,
              processedBlob: blobProcessed,
              originalUrl,
              processedUrl,
              isProcessing: false,
              progress: 100,
              statusText: '已完成',
              taskId: initialTask.id
            });
          } else {
            // Otherwise process it
            processFile(file, initialTask.id);
          }
        } catch (e) {
          console.error("Failed to load task file", e);
        }
      };
      loadTask();
    }
  }, [initialTask]);

  // Sync canvas size with image
  React.useEffect(() => {
    if (tool === 'lasso' && imageRef.current && canvasRef.current) {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      
      const updateSize = () => {
        // Internal resolution matches rendered size for 1:1 mapping with mouse events
        canvas.width = img.offsetWidth;
        canvas.height = img.offsetHeight;
        
        // Match position and size exactly
        canvas.style.width = `${img.offsetWidth}px`;
        canvas.style.height = `${img.offsetHeight}px`;
        canvas.style.left = `${img.offsetLeft}px`;
        canvas.style.top = `${img.offsetTop}px`;
        
        // Clear canvas
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      };

      // Initial update
      updateSize();
      
      // Update on resize
      const observer = new ResizeObserver(updateSize);
      observer.observe(img);
      
      return () => observer.disconnect();
    }
  }, [tool, image?.processedUrl, zoom]);

  const processFile = async (file: File, existingTaskId?: number) => {
    if (!file.type.startsWith('image/')) return;

    let taskId = existingTaskId;
    if (!taskId) {
        try {
            const newTask = await api.createTask('remove-bg', file);
            taskId = newTask.id;
            if (onTaskUpdate) onTaskUpdate();
        } catch (e) {
            console.error("Failed to create task", e);
        }
    }

    const originalUrl = URL.createObjectURL(file);
    
    setImage({
      originalFile: file,
      processedBlob: new Blob(), // Placeholder
      originalUrl,
      processedUrl: '',
      isProcessing: true,
      progress: 0,
      statusText: '初始化模型...',
      taskId
    });
    setError(null);

    try {
      const config: Config = {
        publicPath: window.location.origin + '/models/imgly/', // Use local models
        model: 'medium',
        debug: true, // Enable debug to see what's happening
        progress: (key: string, current: number, total: number) => {
          const percent = Math.round((current / total) * 100);
          setImage(prev => {
            if (!prev) return null;
            let statusText = '处理中...';
            if (key.includes('fetch')) statusText = '下载模型数据...';
            if (key.includes('compute')) statusText = '正在计算...';
            
            return {
              ...prev,
              progress: percent,
              statusText
            };
          });
        }
      };

      const blob = await removeBackground(file, config);
      
      const processedUrl = URL.createObjectURL(blob);

      setImage(prev => prev ? {
        ...prev,
        processedBlob: blob,
        processedUrl,
        isProcessing: false,
        progress: 100,
        statusText: '完成'
      } : null);
      
      // Init history
      setHistory([blob]);
      
      // Update task status
      if (taskId) {
          api.updateTask(taskId, 'completed', blob).then(() => {
            if (onComplete && !existingTaskId) onComplete('图片抠图任务已完成');
            if (onTaskUpdate) onTaskUpdate();
          }).catch(console.error);
      }
    } catch (err) {
      console.error("Background removal failed:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`处理失败: ${errorMessage}。请检查模型文件是否正确加载。`);
      setImage(null);
      if (taskId) {
          api.updateTask(taskId, 'failed').catch(console.error);
      }
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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, []);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const downloadImage = () => {
    if (!image || !image.processedUrl) return;
    const link = document.createElement('a');
    link.href = image.processedUrl;
    const originalName = image.originalFile.name.replace(/\.[^/.]+$/, "");
    link.download = `${originalName}-removed-bg.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setImage(null);
    setError(null);
    setHistory([]);
    setTool('none');
    setCurrentPath([]);
    setZoom('fit');
  };

  const handleZoomIn = () => {
    if (!imageRef.current) return;
    const currentScale = zoom === 'fit' 
        ? (imageRef.current.width / imageRef.current.naturalWidth) 
        : zoom;
    // Limit max zoom
    if (currentScale >= 5) return;
    setZoom(currentScale * 1.25);
  };

  const handleZoomOut = () => {
    if (!imageRef.current) return;
    const currentScale = zoom === 'fit' 
        ? (imageRef.current.width / imageRef.current.naturalWidth) 
        : zoom;
    // Limit min zoom
    if (currentScale <= 0.1) return;
    setZoom(currentScale * 0.8);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool !== 'lasso') return;
    const { nativeEvent } = e;
    const { offsetX, offsetY } = nativeEvent;
    setCurrentPath([{ x: offsetX, y: offsetY }]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (tool !== 'lasso' || currentPath.length === 0) return;
    const { nativeEvent } = e;
    const { offsetX, offsetY } = nativeEvent;
    
    const newPath = [...currentPath, { x: offsetX, y: offsetY }];
    setCurrentPath(newPath);

    // Draw visual feedback
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(newPath[0].x, newPath[0].y);
      for (let i = 1; i < newPath.length; i++) {
        ctx.lineTo(newPath[i].x, newPath[i].y);
      }
      ctx.strokeStyle = '#ef4444'; // Red
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.closePath();
      
      // Optional: fill slightly to show area
      ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
      ctx.fill();
    }
  };

  const handleMouseUp = async () => {
    if (tool !== 'lasso' || currentPath.length < 3 || !image || !imageRef.current) {
        setCurrentPath([]);
        // Clear visual feedback
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const imgElement = imageRef.current;
    
    // 1. Calculate scaling factor (Displayed Size -> Natural Size)
    // We use offsetWidth/Height for displayed size
    const scaleX = imgElement.naturalWidth / imgElement.offsetWidth;
    const scaleY = imgElement.naturalHeight / imgElement.offsetHeight;

    // 2. Create offscreen canvas with natural dimensions
    const offscreen = document.createElement('canvas');
    offscreen.width = imgElement.naturalWidth;
    offscreen.height = imgElement.naturalHeight;
    const ctx = offscreen.getContext('2d');
    
    if (!ctx) return;

    // 3. Draw current processed image onto offscreen canvas
    // We need to load the current processedBlob into an Image source or use the imgElement if it has the current blob url
    // Since imgElement.src is the processedUrl, we can use it.
    ctx.drawImage(imgElement, 0, 0);

    // 4. Apply erasing (Destination Out)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(currentPath[0].x * scaleX, currentPath[0].y * scaleY);
    for (let i = 1; i < currentPath.length; i++) {
        ctx.lineTo(currentPath[i].x * scaleX, currentPath[i].y * scaleY);
    }
    ctx.closePath();
    ctx.fill();

    // 5. Get new Blob
    offscreen.toBlob((newBlob) => {
        if (newBlob) {
            const newUrl = URL.createObjectURL(newBlob);
            
            // Update History
            const newHistory = [...history, newBlob];
            setHistory(newHistory);
            
            // Update State
            setImage(prev => prev ? {
                ...prev,
                processedBlob: newBlob,
                processedUrl: newUrl
            } : null);
        }
    }, 'image/png');

    // Reset path and visual canvas
    setCurrentPath([]);
    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext('2d');
    if (canvas && canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const newHistory = [...history];
    newHistory.pop(); // Remove current
    const previousBlob = newHistory[newHistory.length - 1];
    const newUrl = URL.createObjectURL(previousBlob);
    
    setHistory(newHistory);
    setImage(prev => prev ? {
        ...prev,
        processedBlob: previousBlob,
        processedUrl: newUrl
    } : null);
  };

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {!image ? (
        <div
          className={clsx(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            isDragging ? "border-purple-500 bg-purple-50" : "border-gray-300 hover:border-purple-400 hover:bg-gray-50",
            "bg-white shadow-sm"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => document.getElementById('bg-remove-input')?.click()}
        >
          <input
            type="file"
            id="bg-remove-input"
            className="hidden"
            accept="image/*"
            onChange={onFileSelect}
          />
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-purple-100 rounded-full text-purple-600">
              <Layers size={32} />
            </div>
            <div>
              <p className="text-xl font-medium text-gray-700">点击或拖拽图片到此处</p>
              <p className="text-sm text-gray-500 mt-1">AI 自动识别人物并移除背景</p>
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
              <span className="font-medium text-gray-700 truncate max-w-[200px]">
                {image.originalFile.name}
              </span>
            </div>

            {/* Editing Tools */}
            {!image.isProcessing && (
              <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
                 <button
                   onClick={() => setTool(tool === 'lasso' ? 'none' : 'lasso')}
                   className={clsx(
                     "p-2 rounded-md transition-colors flex items-center gap-2 text-sm font-medium",
                     tool === 'lasso' ? "bg-purple-100 text-purple-700" : "hover:bg-gray-100 text-gray-600"
                   )}
                   title="手动擦除 (套索工具)"
                 >
                   <PenTool size={18} />
                   <span>擦除</span>
                 </button>
                 <div className="w-px h-6 bg-gray-200 mx-1"></div>
                 <button
                   onClick={handleUndo}
                   disabled={history.length <= 1}
                   className="p-2 hover:bg-gray-100 rounded-md text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                   title="撤销"
              >
                <Undo size={18} />
              </button>
              
              <div className="w-px h-6 bg-gray-200 mx-1"></div>
              
              {/* Zoom Controls */}
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-gray-100 rounded-md text-gray-600 transition-colors"
                title="缩小"
              >
                <ZoomOut size={18} />
              </button>
              <span className="text-xs font-medium text-gray-500 min-w-[3rem] text-center select-none">
                {zoom === 'fit' ? '适应' : `${Math.round(zoom * 100)}%`}
              </span>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-gray-100 rounded-md text-gray-600 transition-colors"
                title="放大"
              >
                <ZoomIn size={18} />
              </button>
              <button
                onClick={() => setZoom('fit')}
                className={clsx(
                  "p-2 rounded-md transition-colors",
                  zoom === 'fit' ? "bg-gray-100 text-gray-900" : "hover:bg-gray-100 text-gray-600"
                )}
                title="适应窗口"
              >
                <Maximize size={18} />
              </button>
              <button
                onClick={() => setZoom(1)}
                className={clsx(
                  "p-2 rounded-md transition-colors",
                  zoom === 1 ? "bg-gray-100 text-gray-900" : "hover:bg-gray-100 text-gray-600"
                )}
                title="100% 原始大小"
              >
                <Scan size={18} />
              </button>
            </div>
          )}
          
          <button
              onClick={downloadImage}
              disabled={image.isProcessing}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={18} />
              下载 PNG
            </button>
          </div>

          {/* Preview Area */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-gray-200">
            {/* Original */}
            <div className="p-6 flex flex-col items-center gap-4">
              <div className="text-center">
                <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">原始图片</span>
                <p className="text-lg font-bold text-gray-800">{formatSize(image.originalFile.size)}</p>
              </div>
              <div className="relative group w-full aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center border border-gray-200">
                <img 
                  src={image.originalUrl} 
                  alt="Original" 
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>

            {/* Processed */}
            <div className="p-6 flex flex-col items-center gap-4 bg-purple-50/30">
              <div className="text-center">
                <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">透明背景</span>
                <div className="flex items-center gap-2 justify-center">
                  {image.isProcessing ? (
                    <div className="flex flex-col items-center">
                      <RefreshCw size={20} className="animate-spin text-purple-500 mb-1" />
                      <span className="text-xs text-purple-600 font-medium">{image.statusText} {image.progress}%</span>
                    </div>
                  ) : (
                    <p className="text-lg font-bold text-purple-600">{formatSize(image.processedBlob.size)}</p>
                  )}
                </div>
              </div>
              {/* Checkerboard background for transparency */}
            <div 
              ref={containerRef}
              className={clsx(
                "relative group w-full aspect-video rounded-lg flex items-center justify-center border border-gray-200 bg-gray-100",
                zoom !== 'fit' ? "overflow-auto block" : "overflow-hidden"
              )}
              style={{
                backgroundColor: '#fff',
                backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
              }}
            >
              {image.isProcessing ? (
                 <div className="flex flex-col items-center gap-2 text-gray-400">
                   <span className="text-sm">AI 正在处理...</span>
                 </div>
              ) : (
                <div className={clsx("relative", zoom === 'fit' ? "w-full h-full flex items-center justify-center" : "inline-block align-top")}>
                  <img 
                      ref={imageRef}
                      src={image.processedUrl} 
                      alt="Processed" 
                      className={clsx(
                          "select-none",
                          zoom === 'fit' ? "max-w-full max-h-full object-contain" : "",
                          tool === 'lasso' ? "cursor-crosshair" : ""
                      )}
                      style={zoom !== 'fit' ? { 
                          width: imageRef.current ? imageRef.current.naturalWidth * zoom : 'auto',
                          maxWidth: 'none',
                          maxHeight: 'none'
                      } : {}}
                      onDragStart={(e) => e.preventDefault()}
                  />
                  
                  {/* Interaction Layer */}
                  {tool === 'lasso' && (
                      <canvas 
                          ref={canvasRef}
                          className="absolute z-10 touch-none cursor-crosshair left-0 top-0"
                          onMouseDown={handleMouseDown}
                          onMouseMove={handleMouseMove}
                          onMouseUp={handleMouseUp}
                          onMouseLeave={handleMouseUp}
                      />
                  )}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageBackgroundRemover;
