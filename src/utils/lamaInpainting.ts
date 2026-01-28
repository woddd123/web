import * as ort from 'onnxruntime-web';

// Use explicit relative paths from the current file's served location or root relative paths
// Vite serves public/onnx at /onnx/
// However, onnxruntime-web might be trying to 'import' them which Vite disallows for public assets
// We need to point to the .wasm files, NOT the .mjs files for wasmPaths in most cases
// Or let onnxruntime resolve them.
// Actually, for the latest onnxruntime-web, we should just set the path to the folder.

// To avoid Vite's restriction on importing files from /public, we use the CDN for the WASM/JS backend.
// This also ensures we get the correct matching versions of .mjs and .wasm files.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

// Disable JSEP (JavaScript Execution Provider) to prevent onnxruntime from trying to load 
// the JSEP .mjs helper which causes "Failed to load url" errors in Vite.
// We only want standard WASM CPU inference.
// @ts-ignore - Internal flag
ort.env.wasm.skipJsep = true;

export class LamaInpainting {
    private session: ort.InferenceSession | null = null;
    // Using a quantized LaMA model which is smaller (~60MB) and faster for web
    // Source: Used in various web-based inpainting demos (e.g. lama-cleaner docs)
    // The user prefers a local model for stability and offline use.
    // Please ensure public/models/lama_quantized.onnx or lama_fp32.onnx exists.
    private modelUrl = '/models/lama_fp32.onnx';
    private fallbackModelUrl = '/models/lama_quantized.onnx';
    
    private isInitializing = false;

    async init() {
        if (this.session) return;
        if (this.isInitializing) {
            // Wait for initialization if already in progress
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.session) return;
        }

        this.isInitializing = true;
        try {
            console.log('Loading LaMA model...');
            
            // Try loading fp32 model first, then fallback to quantized
            let response = await fetch(this.modelUrl);
            let finalModelUrl = this.modelUrl;

            if (!response.ok) {
                console.log(`Failed to load ${this.modelUrl}, trying fallback ${this.fallbackModelUrl}`);
                response = await fetch(this.fallbackModelUrl);
                finalModelUrl = this.fallbackModelUrl;
            }

            if (!response.ok) {
                throw new Error(`无法下载模型文件 (${response.status})`);
            }
            
            const modelArrayBuffer = await response.arrayBuffer();
            if (modelArrayBuffer.byteLength < 1024 * 1024) { // Less than 1MB
                throw new Error(`模型文件过小，可能已损坏或下载失败。请重新下载 ${finalModelUrl}`);
            }

            console.log(`Successfully loaded model buffer from ${finalModelUrl}, size: ${(modelArrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);

            // Try WebGPU first, then WASM
            // Note: WebGPU requires serving the model with correct headers (CORS, COOP/COEP)
            // For simplicity and compatibility, we start with WASM (CPU/SIMD)
            const options: ort.InferenceSession.SessionOptions = {
                executionProviders: ['wasm'], 
                graphOptimizationLevel: 'all'
            };
            
            // Pass the buffer directly to avoid re-fetching
            this.session = await ort.InferenceSession.create(modelArrayBuffer, options);
            console.log('LaMA model loaded successfully');
        } catch (e: any) {
            console.error('Failed to load LaMA model:', e);
            if (e.message && (e.message.includes('404') || e.message.includes('Network') || e.message.includes('无法下载'))) {
                throw new Error(`无法加载本地模型。请确保已手动下载模型文件(lama_fp32.onnx 或 lama_quantized.onnx)到 public/models/ 目录。`);
            }
            if (e.message && (e.message.includes('protobuf parsing failed') || e.message.includes('invalid wire type'))) {
                throw new Error(`模型文件损坏或下载不完整。请删除 public/models/ 下的 .onnx 文件并重新下载。`);
            }
            // Propagate the specific error (like file size error)
            throw e;
        } finally {
            this.isInitializing = false;
        }
    }

    async run(imageCtx: CanvasRenderingContext2D, maskCtx: CanvasRenderingContext2D, width: number, height: number): Promise<ImageData | null> {
        if (!this.session) {
            await this.init();
        }
        if (!this.session) throw new Error('Model not initialized');

        // LaMA expects inputs to be resized to 512x512 (or multiples of 8, but 512 is standard training size)
        // We will resize input to 512x512, run inference, and resize output back
        const MODEL_SIZE = 512;

        // 1. Pre-process: Resize and Normalize
        const tensorInputs = this.preprocess(imageCtx, maskCtx, width, height, MODEL_SIZE);

        // 2. Inference
        const feeds: Record<string, ort.Tensor> = {};
        const inputNames = this.session.inputNames;
        // Usually input names are 'image' and 'mask'
        // We need to check what the model expects. 
        // For lama_quantized.onnx from asuv:
        // inputs: image (1,3,H,W), mask (1,1,H,W)
        
        feeds[inputNames[0]] = tensorInputs.image;
        feeds[inputNames[1]] = tensorInputs.mask;

        console.log('Running inference...');
        const results = await this.session.run(feeds);
        
        // 3. Post-process
        const outputName = this.session.outputNames[0];
        const outputTensor = results[outputName];
        
        return this.postprocess(outputTensor, width, height);
    }

    private preprocess(
        imageCtx: CanvasRenderingContext2D, 
        maskCtx: CanvasRenderingContext2D, 
        origW: number, 
        origH: number, 
        targetSize: number
    ): { image: ort.Tensor, mask: ort.Tensor } {
        // Create temporary canvas for resizing
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetSize;
        tempCanvas.height = targetSize;
        const tempCtx = tempCanvas.getContext('2d')!;

        // Draw Image (resized)
        tempCtx.drawImage(imageCtx.canvas, 0, 0, origW, origH, 0, 0, targetSize, targetSize);
        const imgData = tempCtx.getImageData(0, 0, targetSize, targetSize);

        // Draw Mask (resized)
        tempCtx.clearRect(0, 0, targetSize, targetSize);
        tempCtx.drawImage(maskCtx.canvas, 0, 0, origW, origH, 0, 0, targetSize, targetSize);
        const maskData = tempCtx.getImageData(0, 0, targetSize, targetSize);

        // Convert to Tensor (NCHW)
        // Image: 1x3x512x512, Mask: 1x1x512x512
        // Values normalized to 0-1 (or -1 to 1? usually 0-1 for this model)
        // Standard LaMA uses 0-1 float inputs.

        const float32Data = new Float32Array(3 * targetSize * targetSize);
        const float32Mask = new Float32Array(1 * targetSize * targetSize);

        for (let i = 0; i < targetSize * targetSize; i++) {
            // Image (RGB)
            float32Data[i] = imgData.data[i * 4] / 255.0; // R
            float32Data[targetSize * targetSize + i] = imgData.data[i * 4 + 1] / 255.0; // G
            float32Data[2 * targetSize * targetSize + i] = imgData.data[i * 4 + 2] / 255.0; // B

            // Mask (Single channel)
            // Mask in canvas: alpha > 0 or red > 0. 
            // We expect mask to be 1 where missing, 0 where valid.
            // Usually we draw red strokes.
            const maskVal = maskData.data[i * 4 + 3] > 0 ? 1.0 : 0.0;
            float32Mask[i] = maskVal;
        }

        const imageTensor = new ort.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
        const maskTensor = new ort.Tensor('float32', float32Mask, [1, 1, targetSize, targetSize]);

        return { image: imageTensor, mask: maskTensor };
    }

    private postprocess(tensor: ort.Tensor, origW: number, origH: number): ImageData {
        const data = tensor.data;
        // Output shape: 1, 3, 512, 512
        const [batch, channels, height, width] = tensor.dims; // 1, 3, 512, 512
        
        // Detect if output is 0-1 (float) or 0-255 (uint8 or float)
        // If it's Uint8Array, it's definitely 0-255.
        // If it's Float32Array, we need to check the range.
        let isRange0to1 = true;
        
        if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
            isRange0to1 = false;
        } else {
            // Check a sample of pixels to guess the range
            // If we find values > 1.0, it's likely 0-255
            let maxVal = 0;
            // Check first 1000 pixels or so
            const sampleSize = Math.min(data.length, 1000);
            for(let i=0; i<sampleSize; i++) {
                if (Math.abs(Number(data[i])) > 1.0) {
                    maxVal = Math.abs(Number(data[i]));
                }
            }
            if (maxVal > 1.0) {
                isRange0to1 = false;
                console.log('Model output detected as 0-255 range');
            } else {
                console.log('Model output detected as 0-1 range');
            }
        }

        // Convert back to RGBA ImageData (512x512)
        const size = width * height;
        const resultData = new Uint8ClampedArray(size * 4);

        for (let i = 0; i < size; i++) {
            // NCHW -> NHWC
            let r = Number(data[i]);
            let g = Number(data[size + i]);
            let b = Number(data[2 * size + i]);

            // If range is 0-1, scale to 0-255
            if (isRange0to1) {
                r = r * 255;
                g = g * 255;
                b = b * 255;
            }

            // Clamp 0-255
            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));

            resultData[i * 4] = r;
            resultData[i * 4 + 1] = g;
            resultData[i * 4 + 2] = b;
            resultData[i * 4 + 3] = 255; // Alpha
        }

        const resultImageData = new ImageData(resultData, width, height);

        // Resize back to original dimensions
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(resultImageData, 0, 0);

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = origW;
        finalCanvas.height = origH;
        const finalCtx = finalCanvas.getContext('2d')!;
        
        // Smooth resizing
        finalCtx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, origW, origH);
        
        return finalCtx.getImageData(0, 0, origW, origH);
    }
}

export const lamaInpainting = new LamaInpainting();
