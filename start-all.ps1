$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$desktopRoot = Join-Path $projectRoot 'desktop'
$packagedCandidates = @(
    (Join-Path $desktopRoot 'release-final\win-unpacked\MCP AppControl.exe'),
    (Join-Path $desktopRoot 'release-installer\win-unpacked\MCP AppControl.exe'),
    (Join-Path $desktopRoot 'release\win-unpacked\MCP AppControl.exe')
)

$packagedApp = $packagedCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if ($packagedApp) {
    Write-Host "Iniciando MCP AppControl desde: $packagedApp"
    Start-Process -FilePath $packagedApp
    return
}

$electronBinary = Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
    throw 'No existe una compilación Windows ni están instaladas las dependencias. Ejecuta: cd desktop; npm install'
}

Write-Host 'Iniciando MCP AppControl en modo desarrollo...'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $desktopRoot
