$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$inbox = Join-Path $root 'inbox'
New-Item -ItemType Directory -Force -Path $inbox | Out-Null
Write-Host "Once 11 escuchador → http://127.0.0.1:8787"
$seen = @{}
Get-ChildItem $inbox -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object { $seen[$_.Name] = $true }

while ($true) {
  try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/watcher/beat' -Method POST -TimeoutSec 4 | Out-Null
  } catch {
    Write-Host "$(Get-Date -Format HH:mm:ss) servidor no responde"
  }
  Get-ChildItem $inbox -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $seen.ContainsKey($_.Name)) {
      $seen[$_.Name] = $true
      Write-Host ""
      Write-Host "=== NUEVO REPORTE $($_.Name) ==="
      Write-Host (Get-Content $_.FullName -Raw)
    }
  }
  Start-Sleep -Seconds 8
}
