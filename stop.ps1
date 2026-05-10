$ErrorActionPreference = "Continue"

Write-Host "`n🛑 Deteniendo servicios DeliveryTrack (Windows)..." -ForegroundColor Cyan

$ports = @(3000, 5001, 5002, 8080)

foreach ($port in $ports) {
    # Buscar el PID que está escuchando en el puerto
    $pidToKill = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    
    if ($null -ne $pidToKill) {
        # Puede haber múltiples procesos (IPv4, IPv6), tomamos valores únicos
        $uniquePids = $pidToKill | Select-Object -Unique
        foreach ($p in $uniquePids) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            Write-Host "  ✅ Puerto $port (PID=$p) liberado" -ForegroundColor Green
        }
    } else {
        Write-Host "  - Puerto $port ya estaba libre" -ForegroundColor Gray
    }
}

Write-Host "`n✅ Todos los servicios de Node/Python han sido detenidos.`n" -ForegroundColor Cyan
