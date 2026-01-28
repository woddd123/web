#!/bin/bash
set -e

# Create directory if it doesn't exist
mkdir -p public/models

# Define model URL (using hf-mirror for better accessibility in China)
# Original: https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
MODEL_URL="https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
OUTPUT_FILE="public/models/lama_fp32.onnx"

echo "Checking for LaMa model..."

if [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(stat -c%s "$OUTPUT_FILE" 2>/dev/null || stat -f%z "$OUTPUT_FILE")
    if [ "$FILE_SIZE" -lt 150000000 ]; then
        echo "Found incomplete file ($FILE_SIZE bytes). Removing..."
        rm "$OUTPUT_FILE"
    else
        echo "Model already exists and seems valid ($FILE_SIZE bytes). Skipping download."
        exit 0
    fi
fi

echo "Downloading LaMa model from $MODEL_URL..."
curl -L -o "$OUTPUT_FILE" "$MODEL_URL"

echo "Download complete!"
