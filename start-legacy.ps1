# start-all.ps1 — Levanta los servicios de MCP AppControl (Windows / XAMPP)
# Uso:  powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
# Requiere: PHP 8.2+ en PATH, Node.js, MySQL de XAMPP en marcha, y haber
# ejecutado antes:  cd backend; composer install; cp .env.example .env;
#                   php artisan key:generate; php artisan migrate --seed
#                   php artisan token:create dashboard  (y ws-server, mcp-server)
#                   cd ../mcp-server; npm install; npm run build

$root = $PSScriptRoot
# Este script conserva la arquitectura Laravel/MySQL/Node anterior.

if ([string]::IsNullOrWhiteSpace($env:WS_BACKEND_TOKEN)) {
    throw "Define WS_BACKEND_TOKEN antes de iniciar el puente WebSocket."
}

if ([string]::IsNullOrWhiteSpace($env:WS_AUTH_TOKEN)) {
    throw "Define WS_AUTH_TOKEN antes de iniciar el puente WebSocket."
}

Write-Host "== 1/3 Aplicación Laravel (API + dashboard, http://0.0.0.0:8000) =="
Start-Process -WindowStyle Minimized -FilePath "php" `
  -ArgumentList "artisan","serve","--host=0.0.0.0","--port=8000" `
  -WorkingDirectory "$root\backend"

Write-Host "== 2/3 Scheduler de rutinas (schedule:work) =="
Start-Process -WindowStyle Minimized -FilePath "php" `
  -ArgumentList "artisan","schedule:work" `
  -WorkingDirectory "$root\backend"

Write-Host "== 3/3 Servidor WebSocket (puerto 6001) =="
# El proceso hijo hereda estas variables. Se restauran inmediatamente después.
$previousBackendUrl = $env:BACKEND_URL
$previousBackendToken = $env:BACKEND_TOKEN
$previousWsPort = $env:WS_PORT
$env:BACKEND_URL = "http://127.0.0.1:8000/api/v1"
$env:BACKEND_TOKEN = $env:WS_BACKEND_TOKEN
$env:WS_PORT = "6001"
Start-Process -WindowStyle Minimized -FilePath "node" `
  -ArgumentList "dist/websocket-server.js" `
  -WorkingDirectory "$root\mcp-server"
$env:BACKEND_URL = $previousBackendUrl
$env:BACKEND_TOKEN = $previousBackendToken
$env:WS_PORT = $previousWsPort

Write-Host ""
Write-Host "Listo. Abre el dashboard en http://localhost:8000"
Write-Host "La primera vez, pulsa 'Token' e introduce el token de 'dashboard'."
