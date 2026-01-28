import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Image, Video } from 'lucide-react';
import ImageBackgroundRemover from './ImageBackgroundRemover';
import VideoBackgroundRemover from './VideoBackgroundRemover';
import { type Task } from '../api';

interface Props {
  initialTask?: Task | null;
  onTaskUpdate?: () => void;
  onComplete?: (message: string) => void;
}

const BackgroundRemover: React.FC<Props> = ({ initialTask, onTaskUpdate, onComplete }) => {
  const [mode, setMode] = useState<'image' | 'video'>('image');

  useEffect(() => {
    if (initialTask) {
      if (initialTask.type === 'video-remove-bg') {
        setMode('video');
      } else {
        setMode('image');
      }
    }
  }, [initialTask]);

  return (
    <div className="flex flex-col items-center w-full">
      {/* Sub-tabs for Image/Video */}
      <div className="flex bg-gray-100 p-1 rounded-lg mb-6">
        <button
          onClick={() => setMode('image')}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
            mode === 'image' 
              ? "bg-white text-gray-900 shadow-sm" 
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Image size={16} />
          图片抠图
        </button>
        <button
          onClick={() => setMode('video')}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
            mode === 'video' 
              ? "bg-white text-gray-900 shadow-sm" 
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Video size={16} />
          视频抠图
        </button>
      </div>

      <div className="w-full">
        <div className={mode === 'image' ? 'block' : 'hidden'}>
          <ImageBackgroundRemover 
            initialTask={initialTask?.type === 'remove-bg' ? initialTask : undefined} 
            onTaskUpdate={onTaskUpdate} 
            onComplete={onComplete}
          />
        </div>
        <div className={mode === 'video' ? 'block' : 'hidden'}>
          <VideoBackgroundRemover 
            initialTask={initialTask?.type === 'video-remove-bg' ? initialTask : undefined}
            onTaskUpdate={onTaskUpdate}
            onComplete={onComplete}
          />
        </div>
      </div>
    </div>
  );
};


export default BackgroundRemover;
