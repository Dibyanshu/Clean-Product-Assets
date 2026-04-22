#!/bin/bash

# ============================================================================
# Clean Product Assets - Development Server Starter
# ============================================================================
# This script:
# 1. Kills any processes running on ports 3000 (API) and 21168 (Frontend)
# 2. Starts the backend API server
# 3. Starts the frontend development server
#
# HOW TO RUN THIS SCRIPT:
# ============================================================================
#
# On Windows (PowerShell):
#   bash ./start-dev.sh
#   # or
#   .\start-dev.sh (if Git Bash or WSL is configured)
#
# On macOS/Linux:
#   bash ./start-dev.sh
#   # or
#   chmod +x ./start-dev.sh && ./start-dev.sh
#
# ============================================================================

set -e

echo "========================================="
echo "🚀 Clean Product Assets - Dev Server"
echo "========================================="
echo ""

# Function to kill process on a specific port
kill_port() {
  local port=$1
  echo "🔍 Checking port $port..."
  
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows
    if netstat -ano | grep ":$port" > /dev/null 2>&1; then
      echo "⚠️  Port $port is in use. Killing process..."
      # Extract PID and kill it
      pid=$(netstat -ano | grep ":$port" | awk '{print $5}' | head -1)
      if [ ! -z "$pid" ]; then
        taskkill /PID $pid /F > /dev/null 2>&1 || true
        echo "✅ Killed process on port $port (PID: $pid)"
      fi
    else
      echo "✅ Port $port is free"
    fi
  else
    # macOS/Linux
    if lsof -i ":$port" > /dev/null 2>&1; then
      echo "⚠️  Port $port is in use. Killing process..."
      pid=$(lsof -ti :$port)
      kill -9 $pid 2>/dev/null || true
      echo "✅ Killed process on port $port (PID: $pid)"
    else
      echo "✅ Port $port is free"
    fi
  fi
}

# Kill ports
echo "📍 Cleaning up ports..."
kill_port 3000
kill_port 21168
echo ""

# Wait a moment for ports to be released
sleep 2

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm is not installed. Please install it first:"
  echo "   npm install -g pnpm"
  exit 1
fi

echo "📦 Workspace: d:\Project\Clean-Product-Assets"
echo ""

# Start services
echo "🔧 Starting Backend API Server (port 3000)..."
echo "   Command: pnpm --filter @workspace/api-server run dev"
pnpm --filter @workspace/api-server run dev &
API_PID=$!
echo "✅ API Server started (PID: $API_PID)"
echo ""

# Wait for API to initialize
sleep 5

echo "🎨 Starting Frontend Dev Server (port 21168)..."
echo "   Command: PORT=21168 BASE_PATH=/ pnpm --filter @workspace/legacy-modernization-ui run dev"
PORT=21168 BASE_PATH=/ pnpm --filter @workspace/legacy-modernization-ui run dev &
FRONTEND_PID=$!
echo "✅ Frontend Server started (PID: $FRONTEND_PID)"
echo ""

echo "========================================="
echo "✨ Development Servers Running!"
echo "========================================="
echo ""
echo "📍 API Server:   http://localhost:3000"
echo "📍 Frontend:     http://localhost:21168"
echo ""
echo "📝 Logs:"
echo "   API Backend: PID $API_PID"
echo "   Frontend:    PID $FRONTEND_PID"
echo ""
echo "🛑 To stop all servers, press Ctrl+C"
echo ""

# Keep script running
wait
