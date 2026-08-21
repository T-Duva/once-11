# Compila el APK release firmado y lo deja en once-11.apk
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Capacitor 8 necesita JDK 21
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  $jdk21 = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if ($jdk21) { $env:JAVA_HOME = $jdk21 }
}
if ($env:JAVA_HOME) {
  $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
  Write-Host "JAVA_HOME=$env:JAVA_HOME"
}

Write-Host 'Compilando web...'
npm run build | Out-Host

Write-Host 'Sincronizando Capacitor...'
npx cap sync android | Out-Host

$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

if (-not (Test-Path (Join-Path $sdkRoot 'platform-tools\adb.exe'))) {
  Write-Host "Instalando Android SDK en $sdkRoot ..."
  New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
  $zip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
  $url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip
  $extract = Join-Path $env:TEMP 'android-cmdline-tools'
  Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip -DestinationPath $extract
  $cmdRoot = Join-Path $sdkRoot 'cmdline-tools\latest'
  New-Item -ItemType Directory -Force -Path (Split-Path $cmdRoot) | Out-Null
  Remove-Item $cmdRoot -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item (Join-Path $extract 'cmdline-tools') $cmdRoot
  $sdkmanager = Join-Path $cmdRoot 'bin\sdkmanager.bat'
  cmd /c "(for /l %i in (1,1,100) do @echo y) | `"$sdkmanager`" --sdk_root=`"$sdkRoot`" --licenses"
  cmd /c "(for /l %i in (1,1,100) do @echo y) | `"$sdkmanager`" --sdk_root=`"$sdkRoot`" `"platform-tools`" `"platforms;android-35`" `"platforms;android-36`" `"build-tools;35.0.0`""
}

$localProps = Join-Path $root 'android\local.properties'
"sdk.dir=$($sdkRoot -replace '\\','\\')" | Set-Content -Encoding ascii $localProps

$keystore = Join-Path $root 'android\app\once-release.keystore'
if (-not (Test-Path $keystore)) { throw "Falta keystore release: $keystore" }

Write-Host 'Gradle assembleRelease...'
Push-Location (Join-Path $root 'android')
try {
  .\gradlew.bat assembleRelease | Out-Host
} finally {
  Pop-Location
}

$built = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { throw "No se genero $built" }

$apksigner = Join-Path $sdkRoot 'build-tools\35.0.0\apksigner.bat'
if (Test-Path $apksigner) {
  & $apksigner verify --print-certs $built | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "APK no verifica firma" }
}

New-Item -ItemType Directory -Force -Path (Join-Path $root 'apk-out') | Out-Null
Copy-Item $built (Join-Path $root 'apk-out\app-release.apk') -Force
Copy-Item $built (Join-Path $root 'once-11.apk') -Force
$ver = (Get-Content (Join-Path $root 'src\version.ts') -Raw) -replace "(?s).*APP_VERSION = '([^']+)'.*",'$1'
$ver = $ver.Trim()
if ($ver -match '^\d+\.\d+\.\d+( v)?$') {
  '{"version":"' + $ver + '"}' | Set-Content -Path (Join-Path $root 'version.json') -Encoding UTF8 -NoNewline
  Write-Host "version.json -> $ver"
}
$apkDl = Join-Path $root 'apk-dl'
if (Test-Path $apkDl) { Copy-Item $built (Join-Path $apkDl 'once-11.apk') -Force }
Write-Host "Listo: once-11.apk ($( (Get-Item (Join-Path $root 'once-11.apk')).Length ) bytes)"
