# Sincroniza el proyecto nativo iOS (Capacitor). Compilar el .ipa instalable requiere Mac + firma Apple.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host 'Compilando web...'
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build falló ($LASTEXITCODE)" }

Write-Host 'Sincronizando Capacitor iOS...'
npx cap sync ios | Out-Host
if ($LASTEXITCODE -ne 0) { throw "cap sync ios falló ($LASTEXITCODE)" }

$ver = (Get-Content (Join-Path $root 'src\version.ts') -Raw) -replace "(?s).*APP_VERSION = '([^']+)'.*",'$1'
$ver = $ver.Trim()
$parts = $ver.Split('.')
$build = 1
if ($parts.Length -ge 3) {
  $build = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
}
$pbx = Join-Path $root 'ios\App\App.xcodeproj\project.pbxproj'
if (Test-Path $pbx) {
  $txt = Get-Content $pbx -Raw
  $txt = [regex]::Replace($txt, 'MARKETING_VERSION = [^;]+;', "MARKETING_VERSION = $ver;")
  $txt = [regex]::Replace($txt, 'CURRENT_PROJECT_VERSION = [^;]+;', "CURRENT_PROJECT_VERSION = $build;")
  Set-Content -Path $pbx -Value $txt -Encoding utf8 -NoNewline
  Write-Host "Xcode MARKETING_VERSION=$ver CURRENT_PROJECT_VERSION=$build"
}

Write-Host @"
Listo el proyecto nativo iOS (carpeta ios/).
Es una app de verdad (Capacitor), no “Agregar a inicio” de Safari.
El archivo instalable (.ipa) se genera en un Mac / GitHub Actions con firma Apple:
  - secrets: APPLE_TEAM_ID, BUILD_CERTIFICATE_BASE64, P12_PASSWORD, BUILD_PROVISION_PROFILE_BASE64
  - workflow: .github/workflows/ios.yml
Cuando exista once-11.ipa en la raíz, el server lo sirve en /once-11.ipa y /ios/install (OTA).
En esta PC Windows no se puede generar el .ipa.
"@
