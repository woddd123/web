import React, { useEffect, useRef, useState } from 'react';
import { 
  Canvas, 
  IText, 
  PencilBrush, 
  CircleBrush, 
  SprayBrush,
  FabricObject, 
  Rect, 
  Circle, 
  Triangle,
  Shadow,
  loadSVGFromURL,
  util
} from 'fabric';
import { 
  Type, 
  Brush, 
  Eraser, 
  MousePointer2, 
  Undo, 
  Redo, 
  Download, 
  Trash2, 
  Square, 
  Circle as CircleIcon, 
  Triangle as TriangleIcon,
  Palette,
  Layers,
  Move,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  PaintBucket
} from 'lucide-react';
import clsx from 'clsx';

type Tool = 'select' | 'brush' | 'text' | 'eraser' | 'shape' | 'fill';
type ShapeType = 'rect' | 'circle' | 'triangle';

const GraphicDesigner: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<Canvas | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [eraserSize, setEraserSize] = useState(20);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [isShapeFilled, setIsShapeFilled] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Refs for resolving closure staleness in event listeners
  const isProcessingRef = useRef(false);
  const saveHistoryRef = useRef<(canvas: Canvas) => void>(() => {});
  const activeToolRef = useRef<Tool>('brush');
  const colorRef = useRef('#000000');
  const isShapeFilledRef = useRef(true);

  const customCursorRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  
  // Font properties
  const [fontSize, setFontSize] = useState(24);
  const [fontFamily, setFontFamily] = useState('Arial');

  // Initialize Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
      selection: true,
      preserveObjectStacking: true // Selected object doesn't jump to top
    });

    setFabricCanvas(canvas);

    // Event listeners
    const handleSelection = (e: any) => {
      const selected = e.selected?.[0];
      setSelectedObject(selected || null);
      if (selected) {
        // Sync shape style state
        if (selected.isType('rect') || selected.isType('circle') || selected.isType('triangle')) {
             if (selected.fill === 'transparent' || selected.fill === null) {
                 setColor(selected.stroke as string);
                 setIsShapeFilled(false);
             } else {
                 if (typeof selected.fill === 'string') {
                     setColor(selected.fill);
                 }
                 setIsShapeFilled(true);
             }
             
             // Sync stroke width if it exists and is not 0
             if (selected.strokeWidth && selected.strokeWidth > 0) {
                 setStrokeWidth(selected.strokeWidth);
             }
        } else if (selected.fill && typeof selected.fill === 'string') {
             // For text or other objects
             setColor(selected.fill);
        }

        if (selected.isType('i-text')) {
            setFontSize((selected as IText).fontSize || 24);
            setFontFamily((selected as IText).fontFamily || 'Arial');
        }
      }
    };

    const handleObjectModified = () => {
      saveHistoryRef.current(canvas);
    };
    
    const handlePathCreated = () => {
       saveHistoryRef.current(canvas);
    };

    const handleMouseDown = (e: any) => {
        if (activeToolRef.current === 'fill' && e.target) {
            const target = e.target;
            // Support shapes and paths
            if (target.isType('rect') || target.isType('circle') || target.isType('triangle') || target.isType('path')) {
                const newColor = colorRef.current;
                
                // If it's a shape (rect/circle/triangle), we might need to handle the stroke/fill toggle logic
                // But simple "paint bucket" usually just sets the fill.
                // However, to be consistent with our "Outlined/Filled" logic:
                // If we fill it, it becomes "Filled".
                
                target.set({
                    fill: newColor,
                    stroke: 'transparent',
                    strokeWidth: 0
                });
                
                // Also update isShapeFilled state if we selected it (though paint bucket doesn't select usually)
                // But we should sync the Ref/State if this object becomes selected later.
                // The object itself now has fill.
                
                canvas.renderAll();
                saveHistoryRef.current(canvas);
            }
        }
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', () => setSelectedObject(null));
    canvas.on('object:modified', handleObjectModified);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('object:added', (e) => {
        // Skip history save on initial load or internal adds if needed
        // But for user actions, we want it.
        // We'll rely on path:created for brush
        if (!e.target?.isType('path')) { // path:created handles paths
             saveHistoryRef.current(canvas);
        }
    });
    canvas.on('path:created', handlePathCreated);

    // Initial history save
    // We need to wait for the canvas to be ready and state to be initialized
    // But since this is useEffect [], we can't rely on saveHistoryRef yet as it might be empty on first render before assignment?
    // Actually saveHistory is defined below. 
    // We can just call a manual save here, but better to do it via a separate effect or just manually.
    const initialJson = JSON.stringify(canvas.toJSON());
    setHistory([initialJson]);
    setHistoryStep(0);

    return () => {
      canvas.dispose();
    };
  }, []);

  // Handle custom cursor for eraser
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (activeTool === 'eraser' && customCursorRef.current && canvasWrapperRef.current) {
        const rect = canvasWrapperRef.current.getBoundingClientRect();
        const isOverCanvas = 
          e.clientX >= rect.left && 
          e.clientX <= rect.right && 
          e.clientY >= rect.top && 
          e.clientY <= rect.bottom;

        if (isOverCanvas) {
          customCursorRef.current.style.display = 'block';
          customCursorRef.current.style.left = `${e.clientX}px`;
          customCursorRef.current.style.top = `${e.clientY}px`;
          if (fabricCanvas) {
            fabricCanvas.defaultCursor = 'none';
            fabricCanvas.freeDrawingCursor = 'none';
          }
        } else {
          customCursorRef.current.style.display = 'none';
          if (fabricCanvas) {
            fabricCanvas.defaultCursor = 'default';
            fabricCanvas.freeDrawingCursor = 'default';
          }
        }
      } else if (customCursorRef.current) {
        customCursorRef.current.style.display = 'none';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [activeTool, fabricCanvas]);

  // Tool Switching Logic
  useEffect(() => {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;
    fabricCanvas.defaultCursor = 'default';

    switch (activeTool) {
      case 'brush':
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.freeDrawingBrush = new PencilBrush(fabricCanvas);
        fabricCanvas.freeDrawingBrush.width = brushSize;
        fabricCanvas.freeDrawingBrush.color = color;
        break;
      case 'eraser':
        // Simple eraser: White brush (since actual eraser brush needs specific plugin/setup usually)
        // Or we can try to use globalCompositeOperation if supported by standard brush, 
        // but simple white brush is safer for MVP on white canvas.
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.freeDrawingBrush = new PencilBrush(fabricCanvas);
        fabricCanvas.freeDrawingBrush.width = eraserSize;
        fabricCanvas.freeDrawingBrush.color = '#ffffff'; 
        break;
      case 'text':
        fabricCanvas.defaultCursor = 'text';
        break;
      case 'shape':
        fabricCanvas.selection = false;
        break;
      case 'fill':
        fabricCanvas.selection = false; // Disable selection to allow clicking on objects without selecting
        fabricCanvas.defaultCursor = 'cell'; // Use cell cursor or crosshair
        fabricCanvas.hoverCursor = 'cell';
        break;
      case 'select':
      default:
        break;
    }
  }, [activeTool, fabricCanvas]);

  // Update Brush Properties
  useEffect(() => {
    if (!fabricCanvas || !fabricCanvas.freeDrawingBrush) return;
    
    if (activeTool === 'brush') {
      fabricCanvas.freeDrawingBrush.color = color;
      fabricCanvas.freeDrawingBrush.width = brushSize;
    } else if (activeTool === 'eraser') {
      fabricCanvas.freeDrawingBrush.color = '#ffffff';
      fabricCanvas.freeDrawingBrush.width = eraserSize;
    }
  }, [color, brushSize, eraserSize, activeTool, fabricCanvas]);

  // Update Selected Object Properties
  useEffect(() => {
    if (!fabricCanvas || !selectedObject) return;

    if (selectedObject.isType('i-text')) {
        if (selectedObject.fill !== color) {
            selectedObject.set('fill', color);
            fabricCanvas.renderAll();
            saveHistoryRef.current(fabricCanvas);
        }
    } else if (selectedObject.isType('rect') || selectedObject.isType('circle') || selectedObject.isType('triangle')) {
        const currentFill = selectedObject.fill;
        const currentStroke = selectedObject.stroke;
        const currentStrokeWidth = selectedObject.strokeWidth;
        
        const desiredFill = isShapeFilled ? color : 'transparent';
        const desiredStroke = isShapeFilled ? 'transparent' : color;
        const desiredStrokeWidth = isShapeFilled ? 0 : strokeWidth;
        
        if (currentFill !== desiredFill || currentStroke !== desiredStroke || currentStrokeWidth !== desiredStrokeWidth) {
             selectedObject.set({
                 fill: desiredFill,
                 stroke: desiredStroke,
                 strokeWidth: desiredStrokeWidth
             });
             fabricCanvas.renderAll();
             saveHistoryRef.current(fabricCanvas);
        }
    }
  }, [color, isShapeFilled, strokeWidth]); // Added strokeWidth dependency

  // Sync Refs
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    isShapeFilledRef.current = isShapeFilled;
  }, [isShapeFilled]);

  // History Management
  const saveHistory = (canvas: Canvas) => {
    if (isProcessingRef.current) return;
    
    const json = JSON.stringify(canvas.toJSON());
    setHistory(prev => {
      const newHistory = prev.slice(0, historyStep + 1);
      newHistory.push(json);
      return newHistory;
    });
    setHistoryStep(prev => prev + 1);
  };

  // Update ref whenever saveHistory function updates (due to state changes)
  useEffect(() => {
      saveHistoryRef.current = saveHistory;
  }, [saveHistory]); // saveHistory changes when historyStep changes

  const undo = () => {
    if (historyStep <= 0 || !fabricCanvas) return;
    
    setIsProcessing(true);
    // isProcessingRef.current will be updated by useEffect, but that's async.
    // However, saveHistoryRef uses isProcessingRef.current.
    // We should update Ref immediately to block immediate saveHistory calls from events
    isProcessingRef.current = true;
    
    const prevStep = historyStep - 1;
    const json = history[prevStep];
    
    fabricCanvas.loadFromJSON(JSON.parse(json)).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(prevStep);
        setIsProcessing(false);
        // We don't manually set ref to false here, useEffect will handle it when state updates
        // But to be safe against race conditions if events fire before effect:
        // Actually, events are synchronous usually, but loadFromJSON promise is async.
        // Once state updates, effect runs.
    });
  };

  const redo = () => {
    if (historyStep >= history.length - 1 || !fabricCanvas) return;

    setIsProcessing(true);
    isProcessingRef.current = true;
    
    const nextStep = historyStep + 1;
    const json = history[nextStep];

    fabricCanvas.loadFromJSON(JSON.parse(json)).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(nextStep);
        setIsProcessing(false);
    });
  };

  // Actions
  const addText = () => {
    if (!fabricCanvas) return;
    
    const text = new IText('双击编辑文本', {
      left: 100,
      top: 100,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fill: color,
    });
    
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    setActiveTool('select');
  };

  const addShape = (type: ShapeType) => {
    if (!fabricCanvas) return;
    
    let shape: FabricObject;
    
    const commonProps = {
      left: 150,
      top: 150,
      fill: isShapeFilled ? color : 'transparent',
      stroke: isShapeFilled ? 'transparent' : color,
      strokeWidth: isShapeFilled ? 0 : strokeWidth,
      width: 100,
      height: 100
    };

    switch (type) {
      case 'circle':
        shape = new Circle({ ...commonProps, radius: 50 });
        break;
      case 'triangle':
        shape = new Triangle({ ...commonProps });
        break;
      case 'rect':
      default:
        shape = new Rect({ ...commonProps });
        break;
    }

    fabricCanvas.add(shape);
    fabricCanvas.setActiveObject(shape);
    setActiveTool('select');
  };

  const deleteSelected = () => {
    if (!fabricCanvas) return;
    const activeObjects = fabricCanvas.getActiveObjects();
    if (activeObjects.length) {
      fabricCanvas.discardActiveObject();
      activeObjects.forEach((obj) => {
        fabricCanvas.remove(obj);
      });
      saveHistory(fabricCanvas);
    }
  };

  const bringForward = () => {
    if (!fabricCanvas || !selectedObject) return;
    fabricCanvas.bringObjectForward(selectedObject);
    saveHistory(fabricCanvas);
  };

  const sendBackwards = () => {
    if (!fabricCanvas || !selectedObject) return;
    fabricCanvas.sendObjectBackwards(selectedObject);
    saveHistory(fabricCanvas);
  };

  const clearCanvas = () => {
    if (!fabricCanvas) return;
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = '#ffffff';
    saveHistory(fabricCanvas);
  };

  const downloadImage = () => {
    if (!fabricCanvas) return;
    const dataURL = fabricCanvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2 // Higher resolution
    });
    
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'design.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // UI Components
  return (
    <div className="flex h-[calc(100vh-140px)] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Left Toolbar */}
      <div className="w-16 flex flex-col items-center py-4 border-r border-gray-200 bg-gray-50 gap-4">
        <ToolButton 
          active={activeTool === 'select'} 
          onClick={() => setActiveTool('select')} 
          icon={<MousePointer2 size={20} />} 
          title="选择" 
        />
        <ToolButton 
          active={activeTool === 'brush'} 
          onClick={() => setActiveTool('brush')} 
          icon={<Brush size={20} />} 
          title="画笔" 
        />
        <ToolButton 
          active={activeTool === 'eraser'} 
          onClick={() => setActiveTool('eraser')} 
          icon={<Eraser size={20} />} 
          title="橡皮擦" 
        />
        <ToolButton 
          active={activeTool === 'fill'} 
          onClick={() => setActiveTool('fill')} 
          icon={<PaintBucket size={20} />} 
          title="油漆桶 (填充)" 
        />
        <ToolButton 
          active={activeTool === 'text'} 
          onClick={addText} 
          icon={<Type size={20} />} 
          title="添加文本" 
        />
        
        <div className="w-8 h-px bg-gray-300 my-2"></div>
        
        <div className="flex flex-col gap-2">
            <button 
                onClick={() => addShape('rect')}
                className="p-2 text-gray-600 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"
                title="矩形"
            >
                <Square size={20} />
            </button>
            <button 
                onClick={() => addShape('circle')}
                className="p-2 text-gray-600 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"
                title="圆形"
            >
                <CircleIcon size={20} />
            </button>
            <button 
                onClick={() => addShape('triangle')}
                className="p-2 text-gray-600 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"
                title="三角形"
            >
                <TriangleIcon size={20} />
            </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Properties Bar */}
        <div className="h-14 border-b border-gray-200 flex items-center px-4 justify-between bg-white">
          <div className="flex items-center gap-4">
             {/* Common Properties */}
             <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full border border-gray-300 overflow-hidden cursor-pointer relative">
                    <input 
                        type="color" 
                        value={color} 
                        onChange={(e) => setColor(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        title="颜色选择"
                    />
                    <div className="w-full h-full" style={{ backgroundColor: color }}></div>
                </div>
                
                {/* Shape Style Toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => setIsShapeFilled(true)}
                        className={clsx(
                            "p-1 rounded transition-colors",
                            isShapeFilled ? "bg-white shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"
                        )}
                        title="实心"
                    >
                        <Square size={16} fill={isShapeFilled ? "currentColor" : "none"} />
                    </button>
                    <button
                        onClick={() => setIsShapeFilled(false)}
                        className={clsx(
                            "p-1 rounded transition-colors",
                            !isShapeFilled ? "bg-white shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"
                        )}
                        title="空心"
                    >
                        <Square size={16} />
                    </button>
                </div>

                {!isShapeFilled && (
                    <div className="flex items-center gap-2 ml-4 border-l border-gray-200 pl-4">
                        <span className="text-xs text-gray-500">边框粗细: {strokeWidth}</span>
                        <input 
                            type="range" 
                            min="1" 
                            max="20" 
                            value={strokeWidth} 
                            onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                            className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                    </div>
                )}
             </div>

             <div className="w-px h-6 bg-gray-200 mx-2"></div>

             {/* Contextual Properties */}
             {(activeTool === 'brush' || activeTool === 'eraser') && (
                 <div className="flex items-center gap-2">
                     <span className="text-xs text-gray-500">
                         {activeTool === 'brush' ? '画笔粗细' : '橡皮擦大小'}: {activeTool === 'brush' ? brushSize : eraserSize}
                     </span>
                     <input 
                        type="range" 
                        min="1" 
                        max={activeTool === 'brush' ? "50" : "100"} 
                        value={activeTool === 'brush' ? brushSize : eraserSize} 
                        onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (activeTool === 'brush') setBrushSize(val);
                            else setEraserSize(val);
                        }}
                        className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                     />
                     {activeTool === 'eraser' && (
                         <div className="flex items-center justify-center w-12 h-12 border border-gray-200 bg-gray-50 rounded ml-2 overflow-hidden relative">
                             <div 
                                style={{ 
                                    width: eraserSize, 
                                    height: eraserSize,
                                    borderRadius: '50%',
                                    backgroundColor: 'white',
                                    border: '1px solid #9ca3af',
                                    flexShrink: 0
                                }}
                             />
                         </div>
                     )}
                 </div>
             )}
             
             {selectedObject && selectedObject.isType('i-text') && (
                 <div className="flex items-center gap-2">
                     <select 
                        value={fontFamily} 
                        onChange={(e) => {
                            const val = e.target.value;
                            setFontFamily(val);
                            (selectedObject as IText).set('fontFamily', val);
                            fabricCanvas?.renderAll();
                            saveHistory(fabricCanvas!);
                        }}
                        className="text-sm border border-gray-300 rounded px-2 py-1 w-24"
                     >
                         <option value="Arial">Arial</option>
                         <option value="Times New Roman">Times New Roman</option>
                         <option value="Courier New">Courier New</option>
                         <option value="Verdana">Verdana</option>
                     </select>
                     
                     <input 
                        type="number" 
                        value={fontSize} 
                        onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setFontSize(val);
                            (selectedObject as IText).set('fontSize', val);
                            fabricCanvas?.renderAll();
                            saveHistory(fabricCanvas!);
                        }}
                        className="text-sm border border-gray-300 rounded px-2 py-1 w-16"
                        min="8"
                        max="200"
                     />

                     <div className="flex bg-gray-100 rounded-lg p-0.5">
                        <button 
                            onClick={() => {
                                (selectedObject as IText).set('textAlign', 'left');
                                fabricCanvas?.renderAll();
                                saveHistory(fabricCanvas!);
                            }}
                            className="p-1 hover:bg-white rounded text-gray-600"
                        >
                            <AlignLeft size={16} />
                        </button>
                        <button 
                            onClick={() => {
                                (selectedObject as IText).set('textAlign', 'center');
                                fabricCanvas?.renderAll();
                                saveHistory(fabricCanvas!);
                            }}
                            className="p-1 hover:bg-white rounded text-gray-600"
                        >
                            <AlignCenter size={16} />
                        </button>
                        <button 
                            onClick={() => {
                                (selectedObject as IText).set('textAlign', 'right');
                                fabricCanvas?.renderAll();
                                saveHistory(fabricCanvas!);
                            }}
                            className="p-1 hover:bg-white rounded text-gray-600"
                        >
                            <AlignRight size={16} />
                        </button>
                     </div>
                 </div>
             )}
          </div>

          <div className="flex items-center gap-2">
             <button 
                onClick={undo} 
                disabled={historyStep <= 0}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                title="撤销"
             >
                 <Undo size={18} />
             </button>
             <button 
                onClick={redo} 
                disabled={historyStep >= history.length - 1}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                title="重做"
             >
                 <Redo size={18} />
             </button>
             
             <div className="w-px h-6 bg-gray-200 mx-2"></div>

             {selectedObject && (
               <div className="flex items-center gap-1 mr-2">
                  <button 
                    onClick={bringForward}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    title="上移一层"
                  >
                      <ChevronUp size={18} />
                  </button>
                  <button 
                    onClick={sendBackwards}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    title="下移一层"
                  >
                      <ChevronDown size={18} />
                  </button>
                  <div className="w-px h-6 bg-gray-200 mx-2"></div>
               </div>
             )}

             <button 
                onClick={deleteSelected}
                disabled={!selectedObject}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                title="删除选中"
             >
                 <Trash2 size={18} />
             </button>

             <div className="w-px h-6 bg-gray-200 mx-2"></div>

             <button 
                onClick={clearCanvas}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                title="清空画布"
             >
                 <RefreshCw size={18} />
             </button>
             
             <button 
                onClick={downloadImage}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors ml-2"
             >
                 <Download size={16} />
                 导出
             </button>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-gray-100 overflow-auto flex items-center justify-center p-8 relative">
            <div ref={canvasWrapperRef} className="bg-white shadow-lg rounded-lg overflow-hidden">
                <canvas ref={canvasRef} />
            </div>
            
            {/* Custom Eraser Cursor */}
            <div 
                ref={customCursorRef}
                className="fixed pointer-events-none z-50 rounded-full border border-gray-500 bg-white/20 hidden"
                style={{ 
                    width: eraserSize, 
                    height: eraserSize,
                    transform: 'translate(-50%, -50%)'
                }}
            />
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
}> = ({ active, onClick, icon, title }) => (
  <button
    onClick={onClick}
    className={clsx(
      "p-3 rounded-xl transition-all duration-200 group relative",
      active 
        ? "bg-blue-100 text-blue-600 shadow-sm" 
        : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
    )}
    title={title}
  >
    {icon}
  </button>
);

export default GraphicDesigner;
