import React, { useState, useRef, useEffect } from 'react';
import { Canvas, Image as FabricImage, filters, Rect, PencilBrush } from 'fabric';
import { removeBackground, type Config } from '@imgly/background-removal';
import { lamaInpainting } from '../utils/lamaInpainting';
import { 
  Image as ImageIcon, 
  Sliders, 
  Crop, 
  Wand2, 
  Layers, 
  Download, 
  Undo, 
  Redo, 
  Upload,
  Sun,
  Contrast,
  Droplet,
  Aperture,
  Palette,
  ScanFace,
  Mountain,
  Utensils,
  Briefcase,
  User,
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Check,
  X,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Eraser
} from 'lucide-react';
import clsx from 'clsx';

type EditorMode = 'portrait' | 'background' | 'adjust' | 'crop' | 'creative' | 'erase';

// Advanced PatchMatch Algorithm (Global Optimization)
const performInpainting = (
  ctx: CanvasRenderingContext2D, 
  width: number, 
  height: number, 
  maskCtx: CanvasRenderingContext2D
) => {
  const imgData = ctx.getImageData(0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const mask = maskData.data; // Alpha > 0 means masked (to be filled)

  // Configuration
  const patchSize = 9; // Patch size (odd number)
  const halfPatch = Math.floor(patchSize / 2);
  const iterations = 5; // Number of iterations
  
  // Helpers
  const idx = (x: number, y: number) => (y * width + x) * 4;
  const isValid = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
  const isMasked = (x: number, y: number) => {
      if (!isValid(x, y)) return false;
      return mask[idx(x, y) + 3] > 0;
  };

  // Nearest Neighbor Field (NNF): Stores the (x, y) of the source patch for each pixel
  // Format: [x, y, error]
  const nnf = new Int32Array(width * height * 2);
  const nnfDist = new Float32Array(width * height);

  // 1. Initialization
  // Assign random valid source patches to masked pixels
  // Pre-collect valid source pixels to speed up random selection
  const validPixels: {x: number, y: number}[] = [];
  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          if (!isMasked(x, y)) {
              // Only consider pixels where a full patch can be placed around it? 
              // Relaxed: just valid center is enough, boundary checks handled later
              validPixels.push({x, y});
          }
      }
  }

  if (validPixels.length === 0) return; // No source to copy from

  // Distance function (SSD - Sum of Squared Differences)
  const patchDist = (ax: number, ay: number, bx: number, by: number) => {
      let dist = 0;
      let count = 0;
      // We only compare known pixels in the target patch (a) with source patch (b)
      // Actually in PatchMatch inpainting, we compare 'current reconstruction' with source.
      // But initially, 'current reconstruction' is unknown.
      // Standard approach: Initialize reconstruction with random valid patches.
      
      for (let dy = -halfPatch; dy <= halfPatch; dy++) {
          for (let dx = -halfPatch; dx <= halfPatch; dx++) {
              const aX = ax + dx, aY = ay + dy;
              const bX = bx + dx, bY = by + dy;
              
              if (!isValid(aX, aY) || !isValid(bX, bY)) continue;
              
              // In original PatchMatch for inpainting:
              // Distance is calculated between the current guess and the source.
              // For masked pixels, we use the current pixel value in 'data' (which we will update).
              
              const aIdx = idx(aX, aY);
              const bIdx = idx(bX, bY);
              
              const dr = data[aIdx] - data[bIdx];
              const dg = data[aIdx+1] - data[bIdx+1];
              const db = data[aIdx+2] - data[bIdx+2];
              
              dist += dr*dr + dg*dg + db*db;
              count++;
          }
      }
      return count > 0 ? dist / count : Infinity;
  };

  // Initialize NNF and fill masked data with random valid pixels
  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) {
              const randSource = validPixels[Math.floor(Math.random() * validPixels.length)];
              nnf[(y * width + x) * 2] = randSource.x;
              nnf[(y * width + x) * 2 + 1] = randSource.y;
              
              // Initialize pixel data with random source (Current Guess)
              const tIdx = idx(x, y);
              const sIdx = idx(randSource.x, randSource.y);
              data[tIdx] = data[sIdx];
              data[tIdx+1] = data[sIdx+1];
              data[tIdx+2] = data[sIdx+2];
              data[tIdx+3] = 255; // Ensure opaque
              
              nnfDist[y * width + x] = Infinity; // Will be computed
          } else {
              // For unmasked pixels, source is itself (identity)
              nnf[(y * width + x) * 2] = x;
              nnf[(y * width + x) * 2 + 1] = y;
              nnfDist[y * width + x] = 0;
          }
      }
  }

  // Calculate initial distances
  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) {
              const sx = nnf[(y * width + x) * 2];
              const sy = nnf[(y * width + x) * 2 + 1];
              nnfDist[y * width + x] = patchDist(x, y, sx, sy);
          }
      }
  }

  // 2. Iterations (Propagation + Random Search)
  for (let iter = 0; iter < iterations; iter++) {
      const isReverse = iter % 2 === 1;
      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const stepX = isReverse ? -1 : 1;
      const startY = isReverse ? height - 1 : 0;
      const endY = isReverse ? -1 : height;
      const stepY = isReverse ? -1 : 1;

      for (let y = startY; y !== endY; y += stepY) {
          for (let x = startX; x !== endX; x += stepX) {
              if (!isMasked(x, y)) continue;

              const pIdx = y * width + x;
              let bestX = nnf[pIdx * 2];
              let bestY = nnf[pIdx * 2 + 1];
              let bestDist = nnfDist[pIdx];

              // A. Propagation
              // Check neighbors (Left/Top or Right/Bottom)
              const neighbors = isReverse 
                  ? [{dx: 1, dy: 0}, {dx: 0, dy: 1}] // Right, Bottom
                  : [{dx: -1, dy: 0}, {dx: 0, dy: -1}]; // Left, Top

              for (const nb of neighbors) {
                  const nx = x + nb.dx;
                  const ny = y + nb.dy;
                  
                  if (isValid(nx, ny)) {
                      const nIdx = ny * width + nx;
                      // Propose: neighbor's source + offset
                      const propX = nnf[nIdx * 2] - nb.dx;
                      const propY = nnf[nIdx * 2 + 1] - nb.dy;
                      
                      // CRITICAL FIX: Source must be valid AND NOT MASKED
                      // We cannot copy from a pixel that is inside the hole!
                      if (isValid(propX, propY) && !isMasked(propX, propY)) {
                          const dist = patchDist(x, y, propX, propY);
                          if (dist < bestDist) {
                              bestDist = dist;
                              bestX = propX;
                              bestY = propY;
                          }
                      }
                  }
              }

              // B. Random Search
              // Search for better sources by sampling around the CURRENT BEST source
              let radius = Math.max(width, height);
              while (radius > 1) {
                  // Fix: Search around bestX/bestY (Source Domain), not x/y (Target Domain)
                  const rx = Math.floor(bestX + (Math.random() * 2 - 1) * radius);
                  const ry = Math.floor(bestY + (Math.random() * 2 - 1) * radius);
                  
                  if (isValid(rx, ry) && !isMasked(rx, ry)) {
                       const dist = patchDist(x, y, rx, ry);
                       if (dist < bestDist) {
                           bestDist = dist;
                           bestX = rx;
                           bestY = ry;
                       }
                  }
                  radius /= 2;
              }

              // Update NNF
              nnf[pIdx * 2] = bestX;
              nnf[pIdx * 2 + 1] = bestY;
              nnfDist[pIdx] = bestDist;
              
              // Update Image Data immediately (Greedy update for next pixel's comparison)
              const tIdx = idx(x, y);
              const sIdx = idx(bestX, bestY);
              data[tIdx] = data[sIdx];
              data[tIdx+1] = data[sIdx+1];
              data[tIdx+2] = data[sIdx+2];
          }
      }
  }

  // 3. Reconstruction (Voting / Averaging)
  // For better quality, we should average overlapping patches. 
  // But standard PatchMatch often just uses the center pixel of the best patch.
  // The greedy update above already produced a result.
  // To reduce artifacts, we can do a final pass where each pixel is an average of 
  // all patches that overlap it.
  
  const finalData = new Float32Array(width * height * 4);
  const weights = new Float32Array(width * height);
  
  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          // For each pixel (x,y), look at the patch centered at (x,y) defined by NNF
          // The patch at (x,y) comes from (bestX, bestY)
          // It contributes to pixels (x+dx, y+dy) with color from (bestX+dx, bestY+dy)
          
          const sx = nnf[(y * width + x) * 2];
          const sy = nnf[(y * width + x) * 2 + 1];
          
          // Contribution loop
          for (let dy = -halfPatch; dy <= halfPatch; dy++) {
              for (let dx = -halfPatch; dx <= halfPatch; dx++) {
                  const tX = x + dx;
                  const tY = y + dy;
                  const sX = sx + dx;
                  const sY = sy + dy;
                  
                  if (isValid(tX, tY) && isValid(sX, sY)) {
                      const tIdx = (tY * width + tX);
                      const sIdx = idx(sX, sY);
                      
                      // Weight can be based on distance to center (Gaussian) or simple average
                      // Simple average:
                      finalData[tIdx * 4] += data[sIdx];
                      finalData[tIdx * 4 + 1] += data[sIdx + 1];
                      finalData[tIdx * 4 + 2] += data[sIdx + 2];
                      finalData[tIdx * 4 + 3] += 255;
                      weights[tIdx]++;
                  }
              }
          }
      }
  }
  
  // Normalize
  for (let i = 0; i < width * height; i++) {
      if (weights[i] > 0) {
          const tIdx = i * 4;
          data[tIdx] = finalData[tIdx] / weights[i];
          data[tIdx + 1] = finalData[tIdx + 1] / weights[i];
          data[tIdx + 2] = finalData[tIdx + 2] / weights[i];
          data[tIdx + 3] = 255;
          
          // Clear mask so it's not erased again if we call this multiple times
          mask[tIdx + 3] = 0; 
      }
  }

  ctx.putImageData(imgData, 0, 0);
};

const performTransparencyErasure = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  maskCtx: CanvasRenderingContext2D
) => {
  const imgData = ctx.getImageData(0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const mask = maskData.data;

  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i + 3] > 0) {
      data[i + 3] = 0; // Set alpha to 0 (Transparent)
    }
  }
  ctx.putImageData(imgData, 0, 0);
};

interface Props {
    onShowToast?: (message: string, type: 'success' | 'error') => void;
}

const SmartPhotoEditor: React.FC<Props> = ({ onShowToast }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<Canvas | null>(null);
  const [activeMode, setActiveMode] = useState<EditorMode>('adjust');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  
  // Adjustment States
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [blur, setBlur] = useState(0);
  const [noise, setNoise] = useState(0);
  const [sharpen, setSharpen] = useState(0);
  
  // History
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const isProcessingRef = useRef(false);

  // Crop State
  const [isCropping, setIsCropping] = useState(false);
  const [cropZone, setCropZone] = useState<Rect | null>(null);
  const [customCropW, setCustomCropW] = useState(4);
  const [customCropH, setCustomCropH] = useState(3);
  
  // Layout Scaling
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 700, height: 525 });

  // Initialize Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    // Dispose old canvas if exists to force re-initialization when hot-reloading
    if (fabricCanvas) {
        fabricCanvas.dispose();
    }

    const canvas = new Canvas(canvasRef.current, {
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      // backgroundColor: undefined, // Transparent background
      selection: false,
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, []); // Only run once on mount

  // Responsive Scaling
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
        if (!containerRef.current) return;
        const { clientWidth, clientHeight } = containerRef.current;
        const padding = 64; // p-8 * 2
        
        const scaleX = (clientWidth - padding) / canvasDimensions.width;
        const scaleY = (clientHeight - padding) / canvasDimensions.height;
        
        // Use 0.95 factor to leave a little breathing room
        let scale = Math.min(scaleX, scaleY);
        
        // Optional: Cap at 1.0 if we don't want to upscale
        // scale = Math.min(scale, 1); 
        
        setCanvasScale(Math.max(0.1, scale));
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    
    // Initial call
    updateScale();

    return () => observer.disconnect();
  }, [canvasDimensions]); // Re-run when canvas dimensions change

  // Handle Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !fabricCanvas) return;

    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = (f) => {
      const data = f.target?.result as string;
      FabricImage.fromURL(data).then((img) => {
        if (!img.width || !img.height) return;

        fabricCanvas.clear();
        
        // Reset viewport
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        
        // Calculate new canvas dimensions based on image
        // Limit max dimension to avoid performance issues (e.g. 2000px)
        const maxDim = 2000;
        let newWidth = img.width;
        let newHeight = img.height;
        
        // Scale down if image is too large
        if (newWidth > maxDim || newHeight > maxDim) {
            const scale = Math.min(maxDim / newWidth, maxDim / newHeight);
            newWidth = Math.round(newWidth * scale);
            newHeight = Math.round(newHeight * scale);
        }

        // Update canvas size
        fabricCanvas.setDimensions({ width: newWidth, height: newHeight });
        
        // Calculate scale immediately to avoid render glitch
        if (containerRef.current) {
            const { clientWidth, clientHeight } = containerRef.current;
            const padding = 64;
            const scaleX = (clientWidth - padding) / newWidth;
            const scaleY = (clientHeight - padding) / newHeight;
            const scale = Math.min(scaleX, scaleY);
            setCanvasScale(Math.max(0.1, scale));
        }
        
        setCanvasDimensions({ width: newWidth, height: newHeight });

        // Scale image to match the new canvas dimensions exactly
        // Since aspect ratio is preserved, scaling to width is sufficient
        const scale = newWidth / img.width;
        img.scale(scale);
        
        // Set origin to center for better rotation handling later
        img.set({
            originX: 'center',
            originY: 'center',
            left: newWidth / 2,
            top: newHeight / 2,
            selectable: false // Lock image movement for editing focus
        });

        fabricCanvas.add(img);
        fabricCanvas.renderAll();
        setImageLoaded(true);
        saveHistory(fabricCanvas);
      });
    };

    reader.readAsDataURL(file);
  };

  // Filter Logic
  const applyFilter = (filterName: string, value: number) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getObjects()[0] as FabricImage;
    if (!obj) return;

    // We'll map our state to filters
    const filterList = [];

    // Brightness
    if (brightness !== 0) {
      filterList.push(new filters.Brightness({ brightness: brightness / 100 }));
    }
    
    // Contrast
    if (contrast !== 0) {
      filterList.push(new filters.Contrast({ contrast: contrast / 100 }));
    }

    // Saturation
    if (saturation !== 0) {
      filterList.push(new filters.Saturation({ saturation: saturation / 100 }));
    }
    
    // Blur
    if (blur > 0) {
      filterList.push(new filters.Blur({ blur: blur / 100 }));
    }
    
    // Noise
    if (noise > 0) {
      filterList.push(new filters.Noise({ noise: noise }));
    }

    // Sharpen
    if (sharpen > 0) {
      // Variable sharpen strength
      // k is the strength factor. Range 0 to 1 seems reasonable for this kernel.
      // We'll map 0-100 input to 0-1 k.
      const k = sharpen / 100;
      const matrix = [
        0, -k, 0,
        -k, 4 * k + 1, -k,
        0, -k, 0
      ];
      
      filterList.push(new filters.Convolute({
        matrix: matrix
      }));
    }

    obj.filters = filterList;
    obj.applyFilters();
    fabricCanvas.renderAll();
  };

  // Update filters when state changes
  useEffect(() => {
    if (!imageLoaded) return;
    applyFilter('all', 0);
  }, [brightness, contrast, saturation, blur, noise, sharpen]);

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

  const undo = () => {
    if (historyStep <= 0 || !fabricCanvas) return;
    isProcessingRef.current = true;
    const prevStep = historyStep - 1;
    const json = history[prevStep];
    fabricCanvas.loadFromJSON(JSON.parse(json)).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(prevStep);
        isProcessingRef.current = false;
    });
  };

  const redo = () => {
    if (historyStep >= history.length - 1 || !fabricCanvas) return;
    isProcessingRef.current = true;
    const nextStep = historyStep + 1;
    const json = history[nextStep];
    fabricCanvas.loadFromJSON(JSON.parse(json)).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(nextStep);
        isProcessingRef.current = false;
    });
  };

  const downloadImage = () => {
    if (!fabricCanvas) return;
    const dataURL = fabricCanvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2
    });
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'edited-photo.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Preset Handlers
  const applyPreset = (type: string) => {
    switch (type) {
        case 'warm':
            setBrightness(5);
            setContrast(10);
            setSaturation(20);
            break;
        case 'cool':
            setBrightness(0);
            setContrast(10);
            setSaturation(-10);
            break;
        case 'bw':
            setSaturation(-100);
            setContrast(20);
            break;
        case 'vintage':
            setSaturation(-30);
            setContrast(10);
            setBrightness(-5);
            setNoise(10);
            break;
        case 'reset':
            setBrightness(0);
            setContrast(0);
            setSaturation(0);
            setBlur(0);
            setNoise(0);
            setSharpen(0);
            break;
    }
  };

  const handleSmartEnhance = () => {
    setBrightness(5);
    setContrast(15);
    setSaturation(15);
    setSharpen(50); // Trigger sharpen
    setBlur(0);
    setNoise(0);
  };

  // Creative Filters
  const applyCreativeStyle = (style: string) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getObjects()[0] as FabricImage;
    if (!obj) return;

    // Reset base filters for creative styles to avoid conflict
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setBlur(0);
    setNoise(0);

    // Remove existing filters
    obj.filters = [];

    switch (style) {
        case 'anime':
            // High saturation, high contrast
            obj.filters.push(new filters.Saturation({ saturation: 0.5 }));
            obj.filters.push(new filters.Contrast({ contrast: 0.3 }));
            break;
        case 'oil':
            // Blur + Noise
            obj.filters.push(new filters.Blur({ blur: 0.05 }));
            obj.filters.push(new filters.Noise({ noise: 100 }));
            break;
        case 'vintage':
             // Sepia + Noise
            obj.filters.push(new filters.Sepia());
            obj.filters.push(new filters.Noise({ noise: 50 }));
            obj.filters.push(new filters.Contrast({ contrast: 0.1 }));
            break;
        case 'bw':
            obj.filters.push(new filters.Grayscale());
            obj.filters.push(new filters.Contrast({ contrast: 0.2 }));
            break;
        case 'duotone':
             obj.filters.push(new filters.BlendColor({ color: '#ff0000', mode: 'multiply' }));
             break;
    }

    obj.applyFilters();
    fabricCanvas.renderAll();
    saveHistory(fabricCanvas);
  };

  // Crop Handler
  const startCrop = (ratio: number | 'free') => {
    if (!fabricCanvas) return;
    
    // If already cropping, just update the ratio
    if (isCropping && cropZone) {
        updateCropZone(ratio);
        return;
    }

    const obj = fabricCanvas.getObjects().find(o => o instanceof FabricImage);
    if (!obj) return;

    // Create Crop Zone
    const width = obj.width! * obj.scaleX! * 0.8;
    const height = obj.height! * obj.scaleY! * 0.8;
    
    const rect = new Rect({
        left: fabricCanvas.width! / 2,
        top: fabricCanvas.height! / 2,
        width: width,
        height: height,
        fill: 'rgba(0,0,0,0.3)', // Semi-transparent fill to indicate selection
        stroke: '#fff',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerColor: 'white',
        cornerStrokeColor: 'black',
        borderColor: 'white',
        cornerSize: 12,
        transparentCorners: false,
        originX: 'center',
        originY: 'center',
        lockRotation: true,
    });

    fabricCanvas.add(rect);
    fabricCanvas.setActiveObject(rect);
    setCropZone(rect);
    setIsCropping(true);
    
    // Update ratio immediately
    updateCropZone(ratio, rect);
  };

  const updateCropZone = (ratio: number | 'free', zone?: Rect) => {
    const targetZone = zone || cropZone;
    if (!targetZone || !fabricCanvas) return;

    if (ratio === 'free') {
        targetZone.set({
            lockUniScaling: false
        });
    } else {
        // Enforce aspect ratio
        const currentWidth = targetZone.width! * targetZone.scaleX!;
        const newHeight = currentWidth / ratio;
        
        targetZone.set({
            height: newHeight / targetZone.scaleY!,
            lockUniScaling: true
        });
    }
    fabricCanvas.renderAll();
  };

  const confirmCrop = () => {
    if (!fabricCanvas || !cropZone) return;

    const { left, top, width, height, scaleX, scaleY } = cropZone;
    const actualWidth = width * scaleX;
    const actualHeight = height * scaleY;

    // Hide crop zone for capture
    cropZone.visible = false;
    
    const croppedDataUrl = fabricCanvas.toDataURL({
        left: left - actualWidth / 2,
        top: top - actualHeight / 2,
        width: actualWidth,
        height: actualHeight,
        format: 'png',
        multiplier: 2
    });

    FabricImage.fromURL(croppedDataUrl).then((newImg) => {
        fabricCanvas.clear();
        
        // Fit to canvas
        const scale = Math.min(
          (fabricCanvas.width! - 40) / newImg.width!,
          (fabricCanvas.height! - 40) / newImg.height!
        );
        
        newImg.scale(scale);
        newImg.set({
          left: fabricCanvas.width! / 2,
          top: fabricCanvas.height! / 2,
          originX: 'center',
          originY: 'center',
          selectable: false
        });

        fabricCanvas.add(newImg);
        fabricCanvas.renderAll();
        saveHistory(fabricCanvas);
        
        // Reset crop state
        setIsCropping(false);
        setCropZone(null);
    });
  };

  const cancelCrop = () => {
    if (!fabricCanvas || !cropZone) return;
    fabricCanvas.remove(cropZone);
    fabricCanvas.renderAll();
    setIsCropping(false);
    setCropZone(null);
  };

  // Background Removal
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const handleRemoveBg = async () => {
    if (!fabricCanvas || isRemovingBg) return;
    const obj = fabricCanvas.getObjects()[0] as FabricImage;
    if (!obj) return;

    try {
        setIsRemovingBg(true);
        // Get image as blob
        const dataUrl = obj.toDataURL({ format: 'png' });
        const blob = await (await fetch(dataUrl)).blob();

        const config: Config = {
            publicPath: window.location.origin + '/models/imgly/',
            model: 'medium', // Type cast handled by Config interface
        };

        const resultBlob = await removeBackground(blob, config);
        const resultUrl = URL.createObjectURL(resultBlob);

        FabricImage.fromURL(resultUrl).then((newImg) => {
            // Replace old image
            const scale = obj.scaleX || 1;
            newImg.scale(scale);
            newImg.set({
                left: obj.left,
                top: obj.top,
                originX: 'center',
                originY: 'center',
                selectable: false
            });

            fabricCanvas.remove(obj);
            fabricCanvas.add(newImg);
            fabricCanvas.renderAll();
            saveHistory(fabricCanvas);
            setIsRemovingBg(false);
        });

    } catch (error) {
        console.error("Background removal failed:", error);
        alert("背景移除失败，请检查网络或重试。");
        setIsRemovingBg(false);
    }
  };

  // Erase State
  const [brushSize, setBrushSize] = useState(20);
  const [isErasing, setIsErasing] = useState(false);
  const [eraseMode, setEraseMode] = useState<'smart' | 'transparent'>('smart');
  const [inpaintingAlgo, setInpaintingAlgo] = useState<'patchmatch' | 'lama'>('lama');

  // Toggle Drawing Mode & Custom Cursor
  useEffect(() => {
    if (!fabricCanvas) return;
    
    const updateCursor = (opt: any) => {
        if (!cursorRef.current) return;
        // Try multiple properties for robustness across Fabric versions
        const pointer = opt.scenePoint || opt.pointer || opt.absolutePointer;
        if (pointer) {
            cursorRef.current.style.left = `${pointer.x}px`;
            cursorRef.current.style.top = `${pointer.y}px`;
        }
    };

    if (activeMode === 'erase') {
        fabricCanvas.isDrawingMode = true;
        const brush = new PencilBrush(fabricCanvas);
        brush.color = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red
        brush.width = brushSize;
        fabricCanvas.freeDrawingBrush = brush;
        
        // Hide default cursor
        fabricCanvas.freeDrawingCursor = 'none';
        
        // Ensure cursor is visible initially (though React style handles display)
        if (cursorRef.current) {
             cursorRef.current.style.display = 'block';
             cursorRef.current.style.opacity = '1';
        }

        fabricCanvas.on('mouse:move', updateCursor);
        
        // Removed mouse:out/over listeners to prevent cursor flickering or disappearing
        // relying on CSS pointer-events-none and container bounds
    } else {
        fabricCanvas.isDrawingMode = false;
        fabricCanvas.freeDrawingCursor = 'default';
        
        // Let React handle display: none via style prop, 
        // but we can also set it here to be safe immediately
        // However, React render will overwrite style.display based on activeMode
        
        fabricCanvas.off('mouse:move', updateCursor);
    }
    
    return () => {
        fabricCanvas.off('mouse:move', updateCursor);
        fabricCanvas.freeDrawingCursor = 'default';
    };
  }, [activeMode, fabricCanvas]);

  // Update brush size
  useEffect(() => {
      if (fabricCanvas && fabricCanvas.freeDrawingBrush && activeMode === 'erase') {
          fabricCanvas.freeDrawingBrush.width = brushSize;
      }
  }, [brushSize, fabricCanvas, activeMode]);

  const clearSelection = () => {
       if (!fabricCanvas) return;
       const paths = fabricCanvas.getObjects().filter(o => o.type === 'path');
       paths.forEach(p => fabricCanvas.remove(p));
       fabricCanvas.renderAll();
  };

  const handleApplyErase = async () => {
      if (!fabricCanvas) return;
      setIsErasing(true);
      
      // Allow UI to render spinner
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const imgObj = fabricCanvas.getObjects().find(o => o.type === 'image') as FabricImage;
      if (!imgObj) {
          setIsErasing(false);
          return;
      }
      
      const paths = fabricCanvas.getObjects().filter(o => o.type === 'path');
      if (paths.length === 0) {
          setIsErasing(false);
          return;
      }

      try {
        // Use the current scaled dimensions
        const width = Math.round(imgObj.width! * imgObj.scaleX!);
        const height = Math.round(imgObj.height! * imgObj.scaleY!);
        const left = imgObj.left! - width / 2;
        const top = imgObj.top! - height / 2;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d')!;
        
        ctx.drawImage(imgObj.getElement() as HTMLImageElement, 0, 0, width, height);
        
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskCtx = maskCanvas.getContext('2d')!;
        
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = 'red';
        
        paths.forEach((p: any) => {
            maskCtx.save();
            maskCtx.translate(-left, -top);
            p.render(maskCtx);
            maskCtx.restore();
        });
        
        if (eraseMode === 'smart') {
            if (inpaintingAlgo === 'lama') {
                const result = await lamaInpainting.run(ctx, maskCtx, width, height);
                if (result) {
                    // Blend: Only replace masked pixels to preserve original quality in unmasked areas
                    const originalData = ctx.getImageData(0, 0, width, height);
                    const maskData = maskCtx.getImageData(0, 0, width, height);
                    const resultData = result.data;
                    const targetData = originalData.data;
                    const mData = maskData.data;
                    
                    const len = width * height;
                    for (let i = 0; i < len; i++) {
                        const idx = i * 4;
                        // If pixel is masked (Alpha > 0), use the inpainted result
                        if (mData[idx + 3] > 0) {
                            targetData[idx] = resultData[idx];
                            targetData[idx + 1] = resultData[idx + 1];
                            targetData[idx + 2] = resultData[idx + 2];
                            targetData[idx + 3] = 255; // Ensure opaque
                        }
                    }
                    ctx.putImageData(originalData, 0, 0);
                }
            } else {
                performInpainting(ctx, width, height, maskCtx);
            }
        } else {
            performTransparencyErasure(ctx, width, height, maskCtx);
        }
        
        const newUrl = tempCanvas.toDataURL();
        const newImg = await FabricImage.fromURL(newUrl);
        
        newImg.set({
            left: imgObj.left,
            top: imgObj.top,
            scaleX: 1, 
            scaleY: 1,
            originX: 'center',
            originY: 'center',
            selectable: false
        });
        
        fabricCanvas.remove(imgObj);
        paths.forEach(p => fabricCanvas.remove(p));
        
        fabricCanvas.add(newImg);
        fabricCanvas.renderAll();
        saveHistory(fabricCanvas);

      } catch (e: any) {
          console.error(e);
          onShowToast?.(`擦除失败: ${e.message || '未知错误'}`, 'error');
      } finally {
          setIsErasing(false);
      }
  };

  return (
    <div className="flex h-[calc(100vh-100px)] min-h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Left Sidebar - Categories */}
      <div className="w-20 bg-gray-50 border-r border-gray-200 flex flex-col items-center py-4 gap-6 z-10">
        <SidebarButton 
            active={activeMode === 'adjust'} 
            onClick={() => setActiveMode('adjust')} 
            icon={<Sliders size={24} />} 
            label="色彩光影"
        />
        <SidebarButton 
            active={activeMode === 'portrait'} 
            onClick={() => setActiveMode('portrait')} 
            icon={<ScanFace size={24} />} 
            label="人像精修"
        />
        <SidebarButton 
            active={activeMode === 'background'} 
            onClick={() => setActiveMode('background')} 
            icon={<Layers size={24} />} 
            label="背景处理"
        />
        <SidebarButton 
            active={activeMode === 'creative'} 
            onClick={() => setActiveMode('creative')} 
            icon={<Wand2 size={24} />} 
            label="创意效果"
        />
        <SidebarButton 
            active={activeMode === 'crop'} 
            onClick={() => setActiveMode('crop')} 
            icon={<Crop size={24} />} 
            label="构图裁剪"
        />
        <SidebarButton 
            active={activeMode === 'erase'} 
            onClick={() => setActiveMode('erase')} 
            icon={<Eraser size={24} />} 
            label="智能擦除"
        />
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef}
        className="flex-1 bg-gray-100 relative flex items-center justify-center p-8 overflow-hidden min-w-0"
      >
        {!imageLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 z-10 pointer-events-none">
                <ImageIcon size={64} className="mb-4 opacity-50" />
                <p className="text-lg">请上传图片开始编辑</p>
            </div>
        )}
        <div 
            className="transition-transform duration-200 origin-center relative"
            style={{ transform: `scale(${canvasScale})` }}
        >
             <canvas ref={canvasRef} />
             {/* Custom Brush Cursor */}
             <div 
                ref={cursorRef}
                className="absolute pointer-events-none rounded-full border-2 border-white z-[9999]"
                style={{ 
                    width: brushSize, 
                    height: brushSize,
                    display: activeMode === 'erase' ? 'block' : 'none',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(0,0,0,0.1)', // Slight dark tint
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', // Outer black ring for contrast
                    mixBlendMode: 'normal' // Avoid complex blend modes that might fail with stacking contexts
                }}
             />
        </div>
        
        {/* Top Bar inside Canvas Area for Global Actions */}
        <div className="absolute top-4 right-4 flex gap-2">
            <label className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer shadow-sm transition-colors flex items-center gap-2">
                <Upload size={18} />
                <span className="text-sm font-medium">上传图片</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
            <button 
                onClick={undo}
                disabled={historyStep <= 0}
                className="p-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm disabled:opacity-50"
            >
                <Undo size={18} />
            </button>
            <button 
                onClick={redo}
                disabled={historyStep >= history.length - 1}
                className="p-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm disabled:opacity-50"
            >
                <Redo size={18} />
            </button>
            <button 
                onClick={downloadImage}
                disabled={!imageLoaded}
                className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm disabled:opacity-50"
            >
                <Download size={18} />
            </button>
            <div className="w-px h-8 bg-gray-300 mx-1"></div>
            <button 
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm"
                title={showSidebar ? "收起侧边栏" : "展开侧边栏"}
            >
                {showSidebar ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
        </div>
      </div>

      {/* Right Sidebar - Tools & Parameters */}
      <div className={clsx(
        "shrink-0 bg-white border-l border-gray-200 flex flex-col z-10 transition-all duration-300 ease-in-out overflow-hidden",
        showSidebar ? "w-80 opacity-100 translate-x-0" : "w-0 opacity-0 translate-x-full border-l-0"
      )}>
        <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">
                {activeMode === 'adjust' && '色彩与光影'}
                {activeMode === 'portrait' && '人像精修 (AI)'}
                {activeMode === 'background' && '背景处理 (AI)'}
                {activeMode === 'creative' && '创意效果'}
                {activeMode === 'crop' && '构图优化'}
                {activeMode === 'erase' && '智能擦除 (AI)'}
            </h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Adjust Mode */}
            {activeMode === 'adjust' && (
                <>
                    <SliderControl 
                        label="亮度" 
                        icon={<Sun size={16} />} 
                        value={brightness} 
                        min={-100} 
                        max={100} 
                        onChange={setBrightness} 
                    />
                    <SliderControl 
                        label="对比度" 
                        icon={<Contrast size={16} />} 
                        value={contrast} 
                        min={-100} 
                        max={100} 
                        onChange={setContrast} 
                    />
                    <SliderControl 
                        label="饱和度" 
                        icon={<Droplet size={16} />} 
                        value={saturation} 
                        min={-100} 
                        max={100} 
                        onChange={setSaturation} 
                    />
                    <SliderControl 
                        label="模糊" 
                        icon={<Aperture size={16} />} 
                        value={blur} 
                        min={0} 
                        max={100} 
                        onChange={setBlur} 
                    />
                    
                    <div className="pt-4 border-t border-gray-100">
                        <button 
                            onClick={handleSmartEnhance}
                            className="w-full py-2 mb-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg shadow-md hover:from-blue-600 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
                        >
                            <Sparkles size={16} />
                            一键智能增强
                        </button>
                        
                        <h4 className="text-sm font-medium text-gray-700 mb-3">场景预设</h4>
                        <div className="grid grid-cols-2 gap-2">
                            <PresetButton label="原图" onClick={() => applyPreset('reset')} />
                            <PresetButton label="暖调 (婚礼)" onClick={() => applyPreset('warm')} />
                            <PresetButton label="冷调 (风景)" onClick={() => applyPreset('cool')} />
                            <PresetButton label="黑白 (纪实)" onClick={() => applyPreset('bw')} />
                            <PresetButton label="复古 (胶片)" onClick={() => applyPreset('vintage')} />
                        </div>
                    </div>
                </>
            )}

            {/* Creative Mode */}
            {activeMode === 'creative' && (
                <div className="space-y-4">
                     <p className="text-sm text-gray-500 mb-4">应用艺术风格滤镜</p>
                     <div className="grid grid-cols-2 gap-2">
                        <PresetButton label="动漫风格" onClick={() => applyCreativeStyle('anime')} icon={<Sparkles size={14}/>} />
                        <PresetButton label="油画效果" onClick={() => applyCreativeStyle('oil')} icon={<Palette size={14}/>} />
                        <PresetButton label="老照片" onClick={() => applyCreativeStyle('vintage')} />
                        <PresetButton label="黑白映画" onClick={() => applyCreativeStyle('bw')} />
                     </div>
                     <SliderControl 
                        label="颗粒感" 
                        icon={<Aperture size={16} />} 
                        value={noise} 
                        min={0} 
                        max={100} 
                        onChange={setNoise} 
                    />
                </div>
            )}

            {/* Portrait Mode (Mock/Future) */}
            {activeMode === 'portrait' && (
                <div className="space-y-4">
                    <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 mb-4">
                        智能识别人脸，一键美颜优化。
                    </div>
                    <ToggleOption label="智能磨皮" />
                    <ToggleOption label="祛痘祛斑" />
                    <ToggleOption label="消除黑眼圈" />
                    <ToggleOption label="牙齿美白" />
                    <SliderControl label="美白强度" value={50} onChange={() => setBrightness(20)} />
                    <SliderControl label="磨皮强度" value={30} onChange={() => setBlur(10)} />
                </div>
            )}
            
            {/* Background Mode */}
            {activeMode === 'background' && (
                <div className="space-y-4">
                    <button 
                        onClick={handleRemoveBg}
                        disabled={isRemovingBg}
                        className={clsx(
                            "w-full py-2 text-white rounded-lg transition-colors mb-4 flex items-center justify-center gap-2",
                            isRemovingBg ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                        )}
                    >
                        {isRemovingBg ? '正在处理...' : '一键智能抠图'}
                    </button>
                    <ToggleOption label="背景虚化" />
                    <ToggleOption label="去除杂物" />
                    
                    <h4 className="text-sm font-medium text-gray-700 mt-4 mb-2">更换背景</h4>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="h-12 bg-gray-200 rounded cursor-pointer hover:ring-2 ring-blue-500"></div>
                        <div className="h-12 bg-blue-200 rounded cursor-pointer hover:ring-2 ring-blue-500"></div>
                        <div className="h-12 bg-green-200 rounded cursor-pointer hover:ring-2 ring-blue-500"></div>
                    </div>
                </div>
            )}
            
            {/* Crop Mode */}
            {activeMode === 'crop' && (
                <div className="space-y-4">
                    {isCropping ? (
                        <>
                             <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-4">
                                <p className="text-sm text-blue-800 mb-3 font-medium text-center">拖动调整裁剪区域</p>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={cancelCrop}
                                        className="flex-1 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                                    >
                                        <X size={16} /> 取消
                                    </button>
                                    <button 
                                        onClick={confirmCrop}
                                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        <Check size={16} /> 确认
                                    </button>
                                </div>
                             </div>
                        </>
                    ) : (
                         <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-500 text-sm mb-4">
                            选择下方比例开始裁剪
                         </div>
                    )}

                    <h4 className="text-sm font-medium text-gray-700 mb-2">常用比例</h4>
                    <div className="grid grid-cols-3 gap-2">
                        <PresetButton label="自由" onClick={() => startCrop('free')} icon={<Square size={14} className="opacity-50"/>} />
                        <PresetButton label="1:1" onClick={() => startCrop(1)} icon={<Square size={14}/>} />
                        <PresetButton label="4:3" onClick={() => startCrop(4/3)} icon={<RectangleHorizontal size={14}/>} />
                        <PresetButton label="3:4" onClick={() => startCrop(3/4)} icon={<RectangleVertical size={14}/>} />
                        <PresetButton label="16:9" onClick={() => startCrop(16/9)} icon={<RectangleHorizontal size={14}/>} />
                        <PresetButton label="9:16" onClick={() => startCrop(9/16)} icon={<RectangleVertical size={14}/>} />
                    </div>

                    <div className="pt-4 border-t border-gray-100 mt-4">
                         <h4 className="text-sm font-medium text-gray-700 mb-3">自定义比例</h4>
                         <div className="flex items-center gap-2 mb-3">
                            <input 
                                type="number" 
                                value={customCropW}
                                onChange={(e) => setCustomCropW(Number(e.target.value))}
                                className="w-full p-2 border border-gray-300 rounded text-center"
                                placeholder="宽"
                            />
                            <span className="text-gray-400">:</span>
                            <input 
                                type="number" 
                                value={customCropH}
                                onChange={(e) => setCustomCropH(Number(e.target.value))}
                                className="w-full p-2 border border-gray-300 rounded text-center"
                                placeholder="高"
                            />
                         </div>
                         <button 
                            onClick={() => startCrop(customCropW / customCropH)}
                            className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                         >
                            应用自定义比例
                         </button>
                    </div>
                </div>
            )}

            {/* Erase Mode */}
            {activeMode === 'erase' && (
                <div className="space-y-6">
                    {/* Mode Selection */}
                    <div className="bg-gray-50 p-1 rounded-lg flex text-sm mb-4">
                        <button
                            className={clsx(
                                "flex-1 py-1.5 rounded-md transition-all font-medium",
                                eraseMode === 'smart' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                            )}
                            onClick={() => setEraseMode('smart')}
                        >
                            智能修复
                        </button>
                        <button
                            className={clsx(
                                "flex-1 py-1.5 rounded-md transition-all font-medium",
                                eraseMode === 'transparent' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                            )}
                            onClick={() => setEraseMode('transparent')}
                        >
                            透明擦除
                        </button>
                    </div>

                    {/* Algorithm Selection for Smart Erase */}
                    {eraseMode === 'smart' && (
                        <div className="bg-gray-100 p-1 rounded-lg flex text-xs mb-4">
                             <button
                                className={clsx(
                                    "flex-1 py-1 rounded-md transition-all font-medium",
                                    inpaintingAlgo === 'lama' ? "bg-white text-indigo-600 shadow-sm border border-gray-100" : "text-gray-500 hover:text-gray-700"
                                )}
                                onClick={() => setInpaintingAlgo('lama')}
                                title="High Quality AI Inpainting (Requires download)"
                            >
                                LaMA (AI模型)
                            </button>
                            <button
                                className={clsx(
                                    "flex-1 py-1 rounded-md transition-all font-medium",
                                    inpaintingAlgo === 'patchmatch' ? "bg-white text-indigo-600 shadow-sm border border-gray-100" : "text-gray-500 hover:text-gray-700"
                                )}
                                onClick={() => setInpaintingAlgo('patchmatch')}
                                title="Fast Texture Synthesis"
                            >
                                PatchMatch (快速)
                            </button>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex justify-between">
                            <label className="text-sm font-medium text-gray-700">画笔大小</label>
                            <span className="text-sm text-gray-500">{brushSize}px</span>
                        </div>
                        
                        {/* Custom Brush Size Slider */}
                        <div className="flex items-center gap-3 px-1">
                            {/* Small Circle Icon */}
                            <div className="w-2 h-2 rounded-full border border-gray-900 flex-shrink-0"></div>
                            
                            {/* Slider Track Container */}
                            <div className="relative flex-1 h-6 flex items-center group">
                                <input 
                                    type="range" 
                                    min="5" 
                                    max="100" 
                                    value={brushSize} 
                                    onChange={(e) => setBrushSize(Number(e.target.value))}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                />
                                
                                {/* Visible Track */}
                                <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-black transition-all duration-75 ease-out" 
                                        style={{ width: `${(brushSize - 5) / (100 - 5) * 100}%` }}
                                    />
                                </div>
                                
                                {/* Visible Thumb */}
                                <div 
                                    className="absolute w-6 h-6 bg-white border border-gray-200 shadow-md rounded-full pointer-events-none z-10 flex items-center justify-center transition-all duration-75 ease-out group-active:scale-110"
                                    style={{ 
                                        left: `${(brushSize - 5) / (100 - 5) * 100}%`,
                                        transform: 'translateX(-50%)'
                                    }}
                                />
                            </div>
                            
                            {/* Large Circle Icon */}
                            <div className="w-5 h-5 rounded-full border-2 border-gray-900 flex-shrink-0"></div>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <button 
                            onClick={clearSelection}
                            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            清除选区
                        </button>
                        <button 
                            onClick={handleApplyErase}
                            disabled={isErasing}
                            className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isErasing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Check size={18} />}
                            开始擦除
                        </button>
                    </div>
                    
                    <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-700">
                        <p className="font-medium mb-1">使用说明：</p>
                        {eraseMode === 'smart' ? (
                            <p>涂抹想要消除的区域，系统将自动分析周围纹理进行智能填充修复（已增强纹理细节）。</p>
                        ) : (
                            <p>涂抹区域将被完全擦除为透明（需保存为PNG格式以保留透明度）。</p>
                        )}
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

// Helper Components
const SidebarButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
    <button 
        onClick={onClick}
        className={clsx(
            "flex flex-col items-center gap-1 p-2 rounded-lg transition-all w-16",
            active ? "bg-blue-100 text-blue-600" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        )}
    >
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
    </button>
);

const SliderControl = ({ label, icon, value, min = 0, max = 100, onChange }: any) => (
    <div className="space-y-2">
        <div className="flex justify-between items-center text-sm text-gray-700">
            <div className="flex items-center gap-2">
                {icon}
                <span>{label}</span>
            </div>
            <span className="text-gray-500">{value}</span>
        </div>
        <input 
            type="range" 
            min={min} 
            max={max} 
            value={value} 
            onChange={(e) => onChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
    </div>
);

const PresetButton = ({ label, onClick, icon }: any) => (
    <button 
        onClick={onClick}
        className="flex items-center justify-center gap-2 py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 hover:border-gray-300 transition-all"
    >
        {icon}
        {label}
    </button>
);

const ToggleOption = ({ label }: { label: string }) => (
    <div className="flex items-center justify-between py-2">
        <span className="text-sm text-gray-700">{label}</span>
        <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
    </div>
);

export default SmartPhotoEditor;
