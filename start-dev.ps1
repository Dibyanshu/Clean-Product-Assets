# ============================================================================
# Clean Product Assets - Development Server Starter
# ============================================================================
# This script:
# 1. Kills any processes running on ports 3000 (API) and 21168 (Frontend)
# 2. Starts the backend API server
# 3. Starts the frontend development server
#
# HOW TO RUN THIS SCRIPT (Windows PowerShell):
# ============================================================================
#
# Method 1 - Direct execution (if ExecutionPolicy allows):
#   .\start-dev.ps1
#
# Method 2 - Bypass execution policy:
#   powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
#
# Method 3 - From command prompt (cmd):
#   powershell -ExecutionPolicy Bypass -File ".\start-dev.ps1"
#
# ============================================================================

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Clean Product Assets - Dev Server" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Function to kill process on a specific port
function Kill-Port {
    param([int]$Port)
    
    Write-Host "Checking port $Port..." -ForegroundColor Yellow
    
    $netstatOutput = netstat -ano 2>$null | Select-String ":$Port" | Select-Object -First 1
    
    if ($netstatOutput) {
        Write-Host "Port $Port is in use. Killing process..." -ForegroundColor Red
        $processId = ($netstatOutput -split '\s+' | Select-Object -Last 1)
        
        if ($processId -and $processId -match '^\d+$') {
            try {
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                Write-Host "Killed process on port $Port (PID: $processId)" -ForegroundColor Green
            } catch {
                Write-Host "Could not kill process: $_" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "Port $Port is free" -ForegroundColor Green
    }
}

# Kill ports
Write-Host "Cleaning up ports..." -ForegroundColor Cyan
Kill-Port 3000
Kill-Port 21168
Write-Host ""

# Wait for ports to be released
Start-Sleep -Seconds 2

Write-Host "Starting Backend API Server (port 3000)..." -ForegroundColor Cyan
$apiScript = @"
pnpm --filter @workspace/api-server run dev
"@

$apiProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiScript -PassThru
Write-Host "API Server started (PID: $($apiProcess.Id))" -ForegroundColor Green
Write-Host ""

# Wait for API to initialize
Write-Host "Waiting for API server (5 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "Starting Frontend Dev Server (port 21168)..." -ForegroundColor Cyan
$frontendScript = @"
`$env:PORT='21168'
`$env:BASE_PATH='/'
pnpm --filter @workspace/legacy-modernization-ui run dev
"@

$frontendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript -PassThru
Write-Host "Frontend Server started (PID: $($frontendProcess.Id))" -ForegroundColor Green
Write-Host ""

Write-Host "=========================================" -ForegroundColor Green
Write-Host "Development Servers Running!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "API Server:   http://localhost:3000" -ForegroundColor Cyan
Write-Host "Frontend:     http://localhost:21168" -ForegroundColor Cyan
Write-Host ""
Write-Host "API Backend PID: $($apiProcess.Id)"
Write-Host "Frontend PID:    $($frontendProcess.Id)"
Write-Host ""
Write-Host "Ctrl+C to stop servers" -ForegroundColor Yellow
Write-Host ""
