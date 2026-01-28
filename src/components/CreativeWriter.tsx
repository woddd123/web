import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  BookOpen, Edit, Save, Settings, Maximize, Minimize, 
  ChevronLeft, ChevronRight, Type, Sun, Moon, Coffee, 
  ArrowLeft
} from 'lucide-react';
import clsx from 'clsx';
import { api, type Task } from '../api';

interface CreativeWriterProps {
  initialTask?: Task | null;
  onTaskUpdate?: () => void;
  onComplete?: (message: string) => void;
  onNew?: () => void;
}

interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: 'light' | 'dark' | 'sepia';
}

const THEMES = {
  light: { bg: 'bg-white', text: 'text-gray-900', secondary: 'text-gray-600' },
  dark: { bg: 'bg-gray-900', text: 'text-gray-100', secondary: 'text-gray-400' },
  sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5b4636]', secondary: 'text-[#8c7b6c]' },
};

export default function CreativeWriter({ initialTask, onTaskUpdate, onComplete, onNew }: CreativeWriterProps) {
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Reader State
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings>({
    fontSize: 18,
    lineHeight: 1.8,
    theme: 'light'
  });

  // Refs for measurement
  const measureRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load task content
  useEffect(() => {
    if (initialTask && initialTask.type === 'writing') {
      const loadContent = async () => {
        try {
          // Fix: The filename might be encoded or just plain text. 
          // Since we are using the file upload mechanism, we can fetch the file URL.
          // api.getFileUrl returns full URL.
          const url = api.getFileUrl(initialTask.original_file_path);
          const res = await fetch(url);
          const text = await res.text();
          
          // Assuming title is original_filename without extension
          const name = initialTask.original_filename.replace(/\.txt$/, '');
          setTitle(name);
          setContent(text);
          setMode('read'); // Auto switch to read mode for existing tasks? Or maybe stay in edit?
          // Let's default to 'read' for better UX when opening history
        } catch (err) {
          console.error("Failed to load content", err);
        }
      };
      loadContent();
    } else if (!initialTask) {
        // Reset if new task
        setTitle('');
        setContent('');
        setMode('edit');
    }
  }, [initialTask]);

  // Pagination Logic
  const calculatePages = useCallback(() => {
    if (!content || !measureRef.current || !containerRef.current) return;
    
    setIsCalculating(true);
    
    // Allow UI to update before heavy calculation
    setTimeout(() => {
        const measureDiv = measureRef.current!;
        // Increase padding subtraction to ensure content fits within the visual container
        // Header ~73px, Footer ~56px.
        // We need to subtract these from clientHeight if containerRef is the root.
        // Also subtract some safety margin.
        // Let's assume available height is roughly clientHeight - 160px.
        const containerHeight = containerRef.current!.clientHeight - 160; 
        
        // Measure div should match the visual container padding
        // Visual container has p-8 (32px) or md:p-12 (48px).
        // Let's assume the smaller padding for safety or check width.
        // If we set width to clientWidth - padding, we are setting the CONTENT width.
        // But measureDiv needs to simulate the text flow.
        
        const paddingHorizontal = 96; // 48px * 2 (md:p-12) - assume desktop for now or use smaller?
        // If we use larger padding for calculation, we fit less text per line, which is safer (pages will be valid).
        // If we use smaller padding, we fit more text, which might overflow if real padding is larger.
        // So using the LARGEST padding (96px) is safer.
        const containerWidth = Math.min(containerRef.current!.clientWidth, 768) - paddingHorizontal; // max-w-3xl is 768px
        
        // Apply settings to measure div
        measureDiv.style.fontSize = `${settings.fontSize}px`;
        measureDiv.style.lineHeight = `${settings.lineHeight}`;
        measureDiv.style.width = `${containerWidth}px`;
        measureDiv.style.padding = '0'; // We handle width explicitly

        
        // Better splitting for CJK + English mixed content
        // We split by newlines first to preserve paragraph structure
        const paragraphs = content.split('\n');
        const newPages: string[] = [];
        let currentPageContent = '';
        
        // Helper to check if content fits
        const fits = (text: string) => {
            measureDiv.innerText = text;
            return measureDiv.clientHeight <= containerHeight;
        };

        for (let p = 0; p < paragraphs.length; p++) {
            const paragraph = paragraphs[p];
            // If adding this paragraph (plus newline if not first) fits, just add it
            const separator = currentPageContent ? '\n' : '';
            const testContent = currentPageContent + separator + paragraph;
            
            if (fits(testContent)) {
                currentPageContent = testContent;
            } else {
                // Paragraph doesn't fit, we need to split it
                // If we already have content on this page, maybe push it first?
                // But maybe the paragraph itself is larger than a page?
                
                // If currentPageContent is not empty, and just adding the *start* of paragraph fails,
                // we might want to finish the current page first.
                // But let's just go char by char for the overflow part.
                
                // Strategy: Append char by char (or word by word)
                // To support CJK properly, we should really treat it carefully.
                // Let's iterate characters of this paragraph.
                
                const chars = Array.from(paragraph);
                 
                 // If we had previous content, we start with that
                if (currentPageContent) {
                   // Try to add separator
                   if (!fits(currentPageContent + separator)) {
                       newPages.push(currentPageContent);
                       currentPageContent = '';
                   } else {
                       currentPageContent += separator;
                   }
                }
                
                for (let c = 0; c < chars.length; c++) {
                    const char = chars[c];
                    const test = currentPageContent + char;
                    
                    if (fits(test)) {
                        currentPageContent = test;
                    } else {
                        // Full, push page
                        newPages.push(currentPageContent);
                        currentPageContent = char;
                    }
                }
            }
        }
        
        if (currentPageContent.length > 0) {
            newPages.push(currentPageContent);
        }
        
        setPages(newPages);
        setCurrentPage(0);
        setIsCalculating(false);
    }, 10);
  }, [content, settings.fontSize, settings.lineHeight, isFullscreen, mode]);

  // Recalculate pages when entering read mode or changing settings
  useEffect(() => {
    if (mode === 'read') {
      calculatePages();
    }
  }, [mode, settings, calculatePages]);

  // Handle Resize
  useEffect(() => {
      const handleResize = () => {
          if (mode === 'read') calculatePages();
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, [mode, calculatePages]);


  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setIsSaving(true);
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], `${title}.txt`, { type: 'text/plain' });
      await api.createTask('writing', file);
      if (onTaskUpdate) onTaskUpdate();
      if (onComplete) onComplete('保存成功！');
    } catch (err) {
      console.error(err);
      if (onComplete) onComplete('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => console.error(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen change (ESC key)
  useEffect(() => {
      const handleFS = () => {
          setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFS);
      return () => document.removeEventListener('fullscreenchange', handleFS);
  }, []);

  // Page Turning Animation
  const [flipDirection, setFlipDirection] = useState<'left' | 'right' | null>(null);

  const nextPage = () => {
      if (currentPage < pages.length - 1) {
          setFlipDirection('left');
          setTimeout(() => {
            setCurrentPage(p => p + 1);
            setFlipDirection(null);
          }, 300);
      }
  };

  const prevPage = () => {
      if (currentPage > 0) {
          setFlipDirection('right');
          setTimeout(() => {
            setCurrentPage(p => p - 1);
            setFlipDirection(null);
          }, 300);
      }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden min-h-[600px] flex flex-col relative" ref={containerRef}>
      {/* Header (Hidden in Fullscreen Read Mode) */}
      {!isFullscreen && (
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-4">
             {initialTask && (
                 <button onClick={onNew} className="p-2 hover:bg-gray-200 rounded-full" title="返回/新建">
                     <ArrowLeft size={20} />
                 </button>
             )}
             <div className="flex gap-2 bg-gray-200 p-1 rounded-lg">
                <button 
                    onClick={() => setMode('edit')}
                    className={clsx("px-4 py-1.5 rounded-md text-sm font-medium transition-all", mode === 'edit' ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900")}
                >
                    编辑模式
                </button>
                <button 
                    onClick={() => setMode('read')}
                    className={clsx("px-4 py-1.5 rounded-md text-sm font-medium transition-all", mode === 'read' ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900")}
                >
                    阅读模式
                </button>
             </div>
          </div>
          
          <div className="flex items-center gap-2">
            {mode === 'edit' && (
                <button 
                    onClick={handleSave} 
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                    <Save size={18} />
                    {isSaving ? '保存中...' : '保存记录'}
                </button>
            )}
            {mode === 'read' && (
                <button 
                    onClick={toggleFullscreen}
                    className="p-2 hover:bg-gray-200 rounded-lg text-gray-600"
                    title="全屏阅读"
                >
                    <Maximize size={20} />
                </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={clsx("flex-1 flex flex-col relative overflow-hidden", mode === 'read' ? THEMES[settings.theme].bg : 'bg-white')}>
        
        {/* EDIT MODE */}
        {mode === 'edit' && (
            <div className="p-8 max-w-3xl mx-auto flex-1 w-full flex flex-col gap-6 overflow-y-auto">
                <input 
                    type="text" 
                    placeholder="请输入文案标题..." 
                    className="text-3xl font-bold border-none outline-none placeholder-gray-300 w-full bg-transparent"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
                <textarea 
                    className="flex-1 w-full resize-none border-none outline-none text-lg leading-relaxed text-gray-700 placeholder-gray-300 bg-transparent min-h-[300px]"
                    placeholder="在此开始您的创作..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                />
            </div>
        )}

        {/* READ MODE */}
        {mode === 'read' && (
            <div className={clsx("h-full flex flex-col", THEMES[settings.theme].text)}>
                {/* Measurement Div (Hidden) */}
                <div 
                    ref={measureRef} 
                    className="absolute top-0 left-0 invisible pointer-events-none whitespace-pre-wrap break-words"
                    style={{ width: '100%' }} // Will be overridden
                />

                {/* Reader Toolbar (Fullscreen only, shows on hover/interaction) */}
                {(isFullscreen || !isFullscreen) && (
                   <div className={clsx(
                       "absolute top-0 right-0 p-4 z-20 transition-opacity duration-300", 
                       isFullscreen && !showSettings ? "opacity-0 hover:opacity-100" : "opacity-100"
                   )}>
                       <div className="flex gap-2 bg-black/10 backdrop-blur-sm p-2 rounded-lg">
                           <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-white/20 rounded-full" title="设置">
                               <Settings size={20} />
                           </button>
                           {isFullscreen && (
                               <button onClick={toggleFullscreen} className="p-2 hover:bg-white/20 rounded-full" title="退出全屏">
                                   <Minimize size={20} />
                               </button>
                           )}
                       </div>
                   </div>
                )}

                {/* Settings Panel */}
                {showSettings && (
                    <div className="absolute top-16 right-4 w-64 bg-white/95 backdrop-blur shadow-xl rounded-xl p-4 z-30 text-gray-800 animate-in fade-in slide-in-from-top-4">
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">字号</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">A-</span>
                                    <input 
                                        type="range" min="12" max="32" step="2"
                                        value={settings.fontSize}
                                        onChange={(e) => setSettings({...settings, fontSize: Number(e.target.value)})}
                                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <span className="text-lg">A+</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">行距</label>
                                <div className="flex gap-2">
                                    {[1.5, 1.8, 2.2].map(lh => (
                                        <button 
                                            key={lh}
                                            onClick={() => setSettings({...settings, lineHeight: lh})}
                                            className={clsx(
                                                "flex-1 py-1 rounded border text-sm",
                                                settings.lineHeight === lh ? "border-blue-500 text-blue-600 bg-blue-50" : "border-gray-200"
                                            )}
                                        >
                                            {lh}x
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">主题</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setSettings({...settings, theme: 'light'})} className="flex-1 p-2 rounded border border-gray-200 bg-white hover:bg-gray-50 flex justify-center"><Sun size={16} /></button>
                                    <button onClick={() => setSettings({...settings, theme: 'sepia'})} className="flex-1 p-2 rounded border border-[#e3d5b8] bg-[#f4ecd8] text-[#5b4636] hover:brightness-95 flex justify-center"><Coffee size={16} /></button>
                                    <button onClick={() => setSettings({...settings, theme: 'dark'})} className="flex-1 p-2 rounded border border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800 flex justify-center"><Moon size={16} /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Page Content */}
                <div 
                    className="flex-1 flex items-center justify-center relative perspective-1000"
                    onClick={(e) => {
                        // Click left/right side to turn page
                        const width = e.currentTarget.clientWidth;
                        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                        if (x > width / 2) nextPage();
                        else prevPage();
                    }}
                >
                    {isCalculating ? (
                        <div className="flex flex-col items-center gap-3 text-gray-400">
                            <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm">排版计算中...</p>
                        </div>
                    ) : (
                        <div className={clsx(
                            "w-full h-full max-w-3xl p-8 md:p-12 mx-auto whitespace-pre-wrap break-words transition-all duration-300 origin-left",
                            flipDirection === 'left' ? "opacity-0 -translate-x-10 rotate-y-12" : 
                            flipDirection === 'right' ? "opacity-0 translate-x-10 -rotate-y-12" : 
                            "opacity-100 translate-x-0 rotate-y-0"
                        )}
                        style={{
                            fontSize: `${settings.fontSize}px`,
                            lineHeight: settings.lineHeight,
                        }}
                        >
                            {pages[currentPage]}
                        </div>
                    )}
                </div>

                {/* Footer / Pagination */}
                <div className={clsx("p-4 flex justify-between items-center text-sm", THEMES[settings.theme].secondary)}>
                     <div>{title || "无标题"}</div>
                     <div className="flex items-center gap-4">
                         <button onClick={prevPage} disabled={currentPage === 0} className="disabled:opacity-30 hover:text-current"><ChevronLeft /></button>
                         <span>{currentPage + 1} / {pages.length || 1}</span>
                         <button onClick={nextPage} disabled={currentPage === pages.length - 1} className="disabled:opacity-30 hover:text-current"><ChevronRight /></button>
                     </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
