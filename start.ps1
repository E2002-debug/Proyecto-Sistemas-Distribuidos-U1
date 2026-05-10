$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot
$LOG_DIR = Join-Path $ROOT "logs"

if (-not (Test-Path $LOG_DIR)) {
    New-Item -ItemType Directory -Path $LOG_DIR | Out-Null
}

Write-Host "`n--- DeliveryTrack Iniciando servicios (Windows) ---" -ForegroundColor Cyan

# ── 1. RabbitMQ 
Write-Host "[*] Nota: Asegurate de tener RabbitMQ instalado y corriendo." -ForegroundColor Yellow

# ── 2. Tracking Server (Node.js) 
Write-Host "`n[*] Iniciando Tracking Server en puerto 3000..." -ForegroundColor Green
Set-Location (Join-Path $ROOT "backend\tracking-server")
npm install --silent
Start-Process node -ArgumentList "server.js" -RedirectStandardOutput "$LOG_DIR\tracking.log" -RedirectStandardError "$LOG_DIR\tracking_err.log" -WindowStyle Hidden

# ── 3. Python venv 
$VENV = Join-Path $ROOT ".venv"
if (-not (Test-Path $VENV)) {
    Write-Host "`n[*] Creando entorno virtual Python..." -ForegroundColor Green
    python -m venv $VENV
}
$PythonExe = Join-Path $VENV "Scripts\python.exe"
$PipExe = Join-Path $VENV "Scripts\pip.exe"

# ── 4. Billing Service (Flask) 
Write-Host "`n[*] Iniciando Billing Service en puerto 5001..." -ForegroundColor Green
Set-Location (Join-Path $ROOT "backend\billing-service")
& $PipExe install -q -r requirements.txt
Start-Process $PythonExe -ArgumentList "app.py" -RedirectStandardOutput "$LOG_DIR\billing.log" -RedirectStandardError "$LOG_DIR\billing_err.log" -WindowStyle Hidden

# ── 5. Notification Service (Flask) 
Write-Host "`n[*] Iniciando Notification Service en puerto 5002..." -ForegroundColor Green
Set-Location (Join-Path $ROOT "backend\notification-service")
& $PipExe install -q -r requirements.txt
Start-Process $PythonExe -ArgumentList "app.py" -RedirectStandardOutput "$LOG_DIR\notification.log" -RedirectStandardError "$LOG_DIR\notification_err.log" -WindowStyle Hidden

# ── 6. Frontend HTTP Server 
Write-Host "`n[*] Iniciando servidor web del Frontend en puerto 8080..." -ForegroundColor Green
Set-Location (Join-Path $ROOT "frontend")
Start-Process python -ArgumentList "-m http.server 8080" -RedirectStandardOutput "$LOG_DIR\frontend.log" -RedirectStandardError "$LOG_DIR\frontend_err.log" -WindowStyle Hidden

Set-Location $ROOT

Write-Host "`n--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Servicios en proceso de inicio en segundo plano." -ForegroundColor Green
Write-Host "  Frontend:              http://localhost:8080"
Write-Host "  Tracking Server:       http://localhost:3000"
Write-Host "  Billing Service:       http://localhost:5001"
Write-Host "  Notification Service:  http://localhost:5002"
Write-Host "`nRevisa la carpeta logs/ para ver la salida de cada servicio." -ForegroundColor Yellow
Write-Host "--------------------------------------------------`n" -ForegroundColor Cyan
