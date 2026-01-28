import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ImageSegmenter, FilesetResolver, ImageSegmenterResult } from '@mediapipe/tasks-vision';
import { Upload, Download, RefreshCw, X, Video, Play, Pause } from 'lucide-react';
import clsx from 'clsx';
import { formatSize } from '../utils';
import { api, type Task } from '../api';

interface ProcessedVideo {
  originalFile: File;
  originalUrl: string;
  processedUrl: string | null;
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

const VideoBackgroundRemover: React.FC<Props> = ({ initialTask, onTaskUpdate, onComplete }) => {
  const [video, setVideo] = useState<ProcessedVideo | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [invertMask, setInvertMask] = useState(false);
  const invertMaskRef = useRef(false);
  
  // Sync ref with state
  useEffect(() => {
    invertMaskRef.current = invertMask;
  }, [invertMask]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processedVideoRef = useRef<HTMLVideoElement>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const prevTaskIdRef = useRef<number | undefined>(undefined);

  // Initialize MediaPipe ImageSegmenter
  useEffect(() => {
    const initSegmenter = async () => {
      try {
        // 尝试使用本地 WASM 文件，如果失败可以回退到 CDN（这里直接使用本地路径，因为已下载）
        // 注意：FilesetResolver.forVisionTasks 接受一个包含 wasm 文件的目录路径或 URL
        const vision = await FilesetResolver.forVisionTasks(
          "/models" 
        );
        segmenterRef.current = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            // 使用本地模型文件
            modelAssetPath: "/models/selfie_segmenter.tflite",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true
        });
        console.log("Segmenter initialized");
      } catch (err) {
        console.error("Failed to initialize segmenter:", err);
        setError("AI 模型加载失败。请确保 /models 目录下存在 selfie_segmenter.tflite 和 wasm 文件。");
      }
    };
    initSegmenter();
  }, []);

  // Load initial task
  useEffect(() => {
    // Check if we switched from a task to no task (reset)
    if (prevTaskIdRef.current && !initialTask) {
      setVideo(null);
      setIsPlaying(false);
    }
    
    // Update ref
    prevTaskIdRef.current = initialTask?.id;

    if (initialTask && initialTask.type === 'video-remove-bg') {
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

            setVideo({
              originalFile: file,
              originalUrl,
              processedUrl,
              isProcessing: false,
              progress: 100,
              statusText: '已完成',
              taskId: initialTask.id
            });
          } else {
            // Otherwise process it
            processVideo(file, initialTask.id);
          }
        } catch (e) {
          console.error("Failed to load task file", e);
        }
      };
      loadTask();
    }
  }, [initialTask]);

  const processVideo = async (file: File, existingTaskId?: number) => {
    if (!file.type.startsWith('video/')) return;

    let taskId = existingTaskId;
    if (!taskId) {
        try {
            const newTask = await api.createTask('video-remove-bg', file);
            taskId = newTask.id;
            if (onTaskUpdate) onTaskUpdate();
        } catch (e) {
            console.error("Failed to create task", e);
        }
    }

    const originalUrl = URL.createObjectURL(file);
    
    setVideo({
      originalFile: file,
      originalUrl,
      processedUrl: null,
      isProcessing: true,
      progress: 0,
      statusText: '准备处理...',
      taskId
    });
    setError(null);
    setIsPlaying(false);

    // Give UI time to update
    setTimeout(() => startProcessing(originalUrl, taskId), 100);
  };

  const startProcessing = async (videoUrl: string, taskId?: number) => {
    // Wait for segmenter initialization
    let attempts = 0;
    while (!segmenterRef.current && attempts < 100) { // Wait up to 10 seconds
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (!segmenterRef.current) {
      setError("AI 模型加载超时，请刷新页面重试");
      return;
    }

    if (!videoRef.current || !canvasRef.current) {
      setError("组件尚未初始化完成");
      return;
    }

    const videoElement = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) return;

    // Load video metadata to set canvas size
    videoElement.src = videoUrl;
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        resolve(true);
      };
    });

    videoElement.currentTime = 0;
    // Mute video during processing to avoid noise
    videoElement.muted = true;

    // Setup MediaRecorder
    const stream = canvas.captureStream(30); // 30 FPS
    
    // Prefer webm/vp9 with alpha if available, otherwise fallback
    // Note: webm supports transparency (alpha channel)
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }
    
    try {
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
    } catch (e) {
      console.error("MediaRecorder setup failed", e);
      setError("浏览器不支持此格式录制");
      return;
    }

    recordedChunksRef.current = [];
    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const processedUrl = URL.createObjectURL(blob);
      setVideo(prev => prev ? {
        ...prev,
        processedUrl,
        isProcessing: false,
        statusText: '处理完成',
        progress: 100
      } : null);

      if (taskId) {
        api.updateTask(taskId, 'completed', blob).then(() => {
          if (onComplete) onComplete('视频抠图任务已完成');
          if (onTaskUpdate) onTaskUpdate();
        }).catch(console.error);
      }
    };

    mediaRecorderRef.current.start();
    
    // Play video to process frames
    videoElement.onended = () => {
       if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
         mediaRecorderRef.current.stop();
       }
    };
    
    let lastTime = -1;
    
    const processFrame = async () => {
      if (!videoElement.paused && !videoElement.ended) {
        const currentTime = videoElement.currentTime;
        if (currentTime !== lastTime) {
          lastTime = currentTime;
          
          const startTimeMs = performance.now();
          
          if (segmenterRef.current) {
             const segmentationResult = segmenterRef.current.segmentForVideo(videoElement, startTimeMs);
             await drawSegmentation(segmentationResult, videoElement, ctx, canvas.width, canvas.height);
          }
        }
        
        // Update progress
        if (videoElement.duration) {
            const progress = Math.round((videoElement.currentTime / videoElement.duration) * 100);
            setVideo(prev => prev ? { ...prev, progress, statusText: '正在处理视频帧...' } : null);
        }

        if ('requestVideoFrameCallback' in videoElement) {
           (videoElement as any).requestVideoFrameCallback(processFrame);
        } else {
           requestAnimationFrame(processFrame);
        }
      } else if (videoElement.ended) {
         // Stop recording when video ends
         if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
             mediaRecorderRef.current.stop();
         }
      }
    };

    videoElement.onended = () => {
         if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
             mediaRecorderRef.current.stop();
         }
    };

    videoElement.play().then(() => {
        if ('requestVideoFrameCallback' in videoElement) {
            (videoElement as any).requestVideoFrameCallback(processFrame);
        } else {
            requestAnimationFrame(processFrame);
        }
    });
  };

  const drawSegmentation = async (
    result: ImageSegmenterResult, 
    video: HTMLVideoElement, 
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    // Draw original frame
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(video, 0, 0, width, height);

    // Use confidence masks for better quality (soft edges)
    const confidenceMasks = result.confidenceMasks;
    if (!confidenceMasks || confidenceMasks.length === 0) return;

    // Index 1 is usually the person (foreground) in MediaPipe selfie_segmenter
    // Index 0 is background
    const personMask = confidenceMasks[confidenceMasks.length > 1 ? 1 : 0];
    const maskData = personMask.getAsFloat32Array();

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const invert = invertMaskRef.current;

    for (let i = 0; i < maskData.length; i++) {
        const pixelIndex = i * 4;
        let confidence = maskData[i]; // 0..1

        // Apply inversion if requested
        if (invert) {
            confidence = 1 - confidence;
        }

        // Set alpha based on confidence
        data[pixelIndex + 3] = Math.round(confidence * 255);
    }
    
    ctx.putImageData(imageData, 0, 0);
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
      processVideo(files[0]);
    }
  }, []);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processVideo(e.target.files[0]);
    }
  };

  const downloadVideo = () => {
    if (!video || !video.processedUrl) return;
    const link = document.createElement('a');
    link.href = video.processedUrl;
    const originalName = video.originalFile.name.replace(/\.[^/.]+$/, "");
    link.download = `${originalName}-removed-bg.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setVideo(null);
    setError(null);
  };
  
  const togglePlay = () => {
    if (processedVideoRef.current) {
        if (isPlaying) {
            processedVideoRef.current.pause();
        } else {
            processedVideoRef.current.play();
        }
        setIsPlaying(!isPlaying);
    }
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {!video ? (
        <div
          className={clsx(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            isDragging ? "border-pink-500 bg-pink-50" : "border-gray-300 hover:border-pink-400 hover:bg-gray-50",
            "bg-white shadow-sm"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => document.getElementById('video-remove-input')?.click()}
        >
          <input
            type="file"
            id="video-remove-input"
            className="hidden"
            accept="video/*"
            onChange={onFileSelect}
          />
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-pink-100 rounded-full text-pink-600">
              <Video size={32} />
            </div>
            <div>
              <p className="text-xl font-medium text-gray-700">点击或拖拽视频到此处</p>
              <p className="text-sm text-gray-500 mt-1">AI 自动识别人物并移除视频背景</p>
            </div>
            
            <label className="flex items-center gap-2 mt-2 cursor-pointer bg-pink-50 px-4 py-2 rounded-lg hover:bg-pink-100 transition-colors" onClick={(e) => e.stopPropagation()}>
                <input 
                    type="checkbox" 
                    checked={invertMask}
                    onChange={(e) => setInvertMask(e.target.checked)}
                    className="w-4 h-4 text-pink-600 rounded border-gray-300 focus:ring-pink-500"
                />
                <span className="text-gray-700 text-sm font-medium">反转遮罩 (如果人物消失请勾选此项)</span>
            </label>
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
                {video.originalFile.name}
              </span>
            </div>
            
            <button
              onClick={downloadVideo}
              disabled={video.isProcessing || !video.processedUrl}
              className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={18} />
              下载 WebM
            </button>
          </div>

          {/* Processing / Preview Area */}
          <div className="p-6">
             {/* Hidden processing elements */}
             <video 
               ref={videoRef} 
               className="hidden" 
               crossOrigin="anonymous" 
               playsInline
             />
             <canvas ref={canvasRef} className="hidden" />

             {video.isProcessing ? (
                <div className="flex flex-col items-center justify-center py-12">
                   <div className="w-full max-w-md bg-gray-200 rounded-full h-4 mb-4 overflow-hidden">
                     <div 
                       className="bg-pink-600 h-4 rounded-full transition-all duration-300"
                       style={{ width: `${video.progress}%` }}
                     />
                   </div>
                   <p className="text-gray-700 font-medium">{video.statusText} {video.progress}%</p>
                   <p className="text-sm text-gray-500 mt-2">处理过程需要播放视频，请勿关闭页面</p>
                </div>
             ) : (
                <div className="flex flex-col items-center gap-4">
                    <div 
                        className="relative w-full max-w-3xl aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200"
                        style={{
                            backgroundColor: '#fff',
                            backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                            backgroundSize: '20px 20px',
                            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                        }}
                    >
                        <video 
                            ref={processedVideoRef}
                            src={video.processedUrl || ''}
                            className="w-full h-full object-contain"
                            loop
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                        />
                        
                        {/* Play Overlay */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                            <button 
                                onClick={togglePlay}
                                className="p-3 bg-white/90 backdrop-blur rounded-full shadow-lg hover:bg-white text-gray-800 transition-all"
                            >
                                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500">提示：生成的 WebM 视频包含 Alpha 通道，支持透明背景。</p>
                </div>
             )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoBackgroundRemover;
