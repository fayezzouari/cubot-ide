#!/bin/bash

# Build script for compiler Docker images

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="${SCRIPT_DIR}/docker/compilers"

echo "Building CuBot compiler images..."

# Build Arduino compiler
echo "Building Arduino compiler image..."
docker build -t cubot/arduino-compiler:latest -f "${DOCKER_DIR}/Dockerfile.arduino" "${DOCKER_DIR}"

# Build TI ARM compiler
echo "Building TI ARM compiler image..."
docker build -t cubot/ti-arm-compiler:latest -f "${DOCKER_DIR}/Dockerfile.ti-arm" "${DOCKER_DIR}"

# Build ESP32 compiler
echo "Building ESP32 compiler image..."
docker build -t cubot/esp32-compiler:latest -f "${DOCKER_DIR}/Dockerfile.esp32" "${DOCKER_DIR}"

# Build AVR Simulator
SIMULATOR_DIR="${SCRIPT_DIR}/docker/simulator"
echo "Building AVR simulator image..."
docker build -t cubot/avr-simulator:latest -f "${SIMULATOR_DIR}/Dockerfile.simulator" "${SIMULATOR_DIR}"

echo ""
echo "All compiler and simulator images built successfully!"
echo ""
echo "Images created:"
docker images | grep "cubot/"
