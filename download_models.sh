#!/bin/bash
set -e

MODEL_DIR="public/models"
MODEL_FILE="$MODEL_DIR/lama_fp32.onnx"
MODEL_URL="https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
MIN_SIZE=100000000 # 100MB

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE" 2>/dev/null)
    if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
        echo "Existing model file is too small ($FILE_SIZE bytes). Re-downloading..."
        rm "$MODEL_FILE"
    else
        echo "Model already exists ($FILE_SIZE bytes). Skipping download."
        exit 0
    fi
fi

echo "Downloading lama_fp32.onnx..."
curl -L -o "$MODEL_FILE" "$MODEL_URL"

# Verify download
if [ -f "$MODEL_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE" 2>/dev/null)
    if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
        echo "Error: Downloaded file is too small ($FILE_SIZE bytes). Download failed."
        rm "$MODEL_FILE"
        exit 1
    else
        echo "Download complete ($FILE_SIZE bytes)."
    fi
else
    echo "Error: File not found after download."
    exit 1
fi
