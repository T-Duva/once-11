# Once 11 keep-alive: servidor + escuchador + tunel publico (8787).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$serverJson = Join-Path $root 'server.json'
$tunnelLog = Join-Path $root 'tools\_tunnelmole.log'
$keepLog = Join-Path $root 'tools\_keep-alive.log'
$pollSecActive = 25
$pollSecSleep = 20
$appForceId = 'once11'
$port = 8787
$localHealth = "http://127.0.0.1:$port/api/health"
$lanFallback = 'http://192.168.1.27:8787'
$escucharMatch = 'once-11\\tools\\escuchar\.ps1'
$serverMatch = 'once-11[/\\].*server[/\\]index\.mjs'
$failThreshold = 3
$minRestartGapSec = 45
$script:ModeActive = $null
$script:PublicFailCount = 0
$script:LastTunnelRestart = [datetime]::MinValue
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Keep([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  try { Add-Content -Path $keepLog -Value $line -Encoding UTF8 } catch {}
}

function Test-AppProcess([string]$pattern) {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern })
}

function Test-ForceActive {
  $forceRoot = 'E:\escuchadores-bot\data\force'
  foreach ($id in @('all', $appForceId)) {
    $file = Join-Path $forceRoot $id
    if (-not (Test-Path $file)) { continue }
    try {
      $j = Get-Content $file -Raw -ErrorAction Stop | ConvertFrom-Json
      if ([string]$j.mode -eq 'manual') { return $true }
      $atRaw = [string]$j.at
      if (-not $atRaw) { return $true }
      $at = [datetime]::Parse($atRaw, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
      $ageH = ([datetime]::UtcNow - $at.ToUniversalTime()).TotalHours
      if ($ageH -lt 24) { return $true }
    } catch {
      return $true
    }
  }
  return $false
}

function Test-ShouldBeOn {
  if (Test-ForceActive) { return $true }
  $h = (Get-Date).Hour
  if ($h -ge 8 -and $h -le 21) { return $true }
  if ((Test-AppProcess $escucharMatch).Count -gt 0) { return $true }
  return $false
}

function Test-UrlOk([string]$url, [int]$timeoutSec = 8) {
  if (-not $url) { return $false }
  try {
    # UA de celular + bypass: localtunnel frena WebView con cartel HTML y el keep-alive
    # (UA de PowerShell) creía que el túnel estaba sano → app “Apagado”.
    $headers = @{
      'User-Agent' = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Once11-KeepAlive'
      'bypass-tunnel-reminder' = '1'
      'Accept' = 'application/json'
    }
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -Headers $headers -ErrorAction Stop
    if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) { return $false }
    $body = [string]$r.Content
    if ($body -match 'Tunnel website ahead' -or $body -match '(?i)<html') { return $false }
    if ($url -match '/api/health') {
      return ($body -match '"app"\s*:\s*"once11"')
    }
    return $true
  } catch {
    return $false
  }
}

function Get-PublishedUrl {
  try {
    $j = Get-Content $serverJson -Raw -ErrorAction Stop | ConvertFrom-Json
    return ([string]$j.url).Trim().TrimEnd('/')
  } catch {
    return ''
  }
}

function Set-PublishedUrl([string]$url) {
  $url = $url.Trim().TrimEnd('/')
  $json = '{"url":"' + $url + '"}'
  [IO.File]::WriteAllText($serverJson, $json, $utf8NoBom)
  $serverTs = Join-Path $root 'src\lib\server.ts'
  if (Test-Path $serverTs) {
    try {
      $txt = [IO.File]::ReadAllText($serverTs)
      $txt2 = [regex]::Replace(
        $txt,
        "const FALLBACKS = \[[\s\S]*?\]",
        "const FALLBACKS = [`r`n  '$url',`r`n  '$lanFallback',`r`n]"
      )
      if ($txt2 -ne $txt) {
        [IO.File]::WriteAllText($serverTs, $txt2, $utf8NoBom)
      }
    } catch {}
  }
}

function Push-ServerJson([string]$url) {
  try {
    & git -C $root add -- server.json 2>$null | Out-Null
    $st = & git -C $root status --porcelain -- server.json 2>$null
    if (-not $st) {
      Write-Keep "git: server.json sin cambios ($url)"
      return
    }
    & git -C $root commit -m "Update public tunnel URL (keep-alive)." 2>&1 | Out-Null
    & git -C $root push origin master 2>&1 | Out-Null
    Write-Keep "git: push OK -> $url"
  } catch {
    Write-Keep "git push FAIL: $($_.Exception.Message)"
  }
}

function Ensure-Server {
  if (Test-UrlOk $localHealth 5) { return $true }
  Write-Keep 'local health FAIL -> reinicio servidor'
  Test-AppProcess $serverMatch | ForEach-Object {
    Write-Keep "kill servidor pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  Start-Process -FilePath 'node' -ArgumentList @(Join-Path $root 'server\index.mjs') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  return (Test-UrlOk $localHealth 5)
}

function Ensure-Escuchador {
  if ((Test-AppProcess $escucharMatch).Count -gt 0) { return }
  Write-Keep 'escuchador ausente -> arranque'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $root 'tools\escuchar.ps1')
  ) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

function Stop-PublicTunnel {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      ($_.CommandLine -match [string]$port) -and
      ($_.CommandLine -match 'tunnelmole|tmole|localtunnel|cloudflared')
    } |
    ForEach-Object {
      Write-Keep "kill tunnel pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-CloudflaredAndWaitUrl {
  $outLog = Join-Path $root 'tools\_cloudflared.out.log'
  $errLog = Join-Path $root 'tools\_cloudflared.err.log'
  foreach ($f in @($outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep "arrancando cloudflared $port..."
  $cfBin = Join-Path $root 'tools\cloudflared.exe'
  if (Test-Path $cfBin) {
    $p = Start-Process -FilePath $cfBin -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$port", '--no-autoupdate') `
      -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  } else {
    $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'cloudflared', 'tunnel', '--url', "http://127.0.0.1:$port", '--no-autoupdate') `
      -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  }

  $deadline = (Get-Date).AddSeconds(75)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.trycloudflare\.com)') {
      $url = 'https://' + $Matches[1]
      Write-Keep "cloudflared URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'cloudflared: no aparecio URL a tiempo'
  return $null
}

function Start-TunnelmoleAndWaitUrl {
  $outLog = Join-Path $root 'tools\_tunnelmole.out.log'
  $errLog = Join-Path $root 'tools\_tunnelmole.err.log'
  foreach ($f in @($tunnelLog, $outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep "arrancando tunnelmole $port..."
  $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'tunnelmole', "$port") `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog, $tunnelLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.tunnelmole\.net)') {
      $url = 'https://' + $Matches[1]
      try { [IO.File]::WriteAllText($tunnelLog, $raw, $utf8NoBom) } catch {}
      Write-Keep "tunnelmole URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'tunnelmole: no aparecio URL a tiempo'
  return $null
}

function Start-LocaltunnelAndWaitUrl {
  $outLog = Join-Path $root 'tools\_localtunnel.out.log'
  $errLog = Join-Path $root 'tools\_localtunnel.err.log'
  foreach ($f in @($outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep "arrancando localtunnel $port..."
  $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'localtunnel', '--port', "$port") `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.loca\.lt)') {
      $url = 'https://' + $Matches[1]
      Write-Keep "localtunnel URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'localtunnel: no aparecio URL a tiempo'
  return $null
}

function Wait-TunnelHealth([string]$newUrl) {
  for ($i = 0; $i -lt 12; $i++) {
    if (Test-UrlOk "$newUrl/api/health" 10) { return $true }
    Start-Sleep -Seconds 3
  }
  Write-Keep "tunel nuevo no responde health: $newUrl"
  return $false
}

function Ensure-PublicTunnel {
  $url = Get-PublishedUrl
  if ($url -and (Test-UrlOk "$url/api/health" 12)) {
    $script:PublicFailCount = 0
    return $true
  }

  $script:PublicFailCount++
  Write-Keep "publico FAIL ($url) intento $($script:PublicFailCount)/$failThreshold"
  if ($script:PublicFailCount -lt $failThreshold) { return $false }

  $since = ((Get-Date) - $script:LastTunnelRestart).TotalSeconds
  if ($since -lt $minRestartGapSec) {
    $wait = [math]::Ceiling($minRestartGapSec - $since)
    Write-Keep "cooldown tunel: faltan ${wait}s (no reinicio todavia)"
    return $false
  }

  Write-Keep "reinicio tunel SOLO $port (prefer cloudflared -> tunnelmole -> localtunnel)"
  Stop-PublicTunnel
  Start-Sleep -Seconds 2
  $newUrl = Start-CloudflaredAndWaitUrl
  if (-not $newUrl) { $newUrl = Start-TunnelmoleAndWaitUrl }
  if (-not $newUrl) { $newUrl = Start-LocaltunnelAndWaitUrl }
  if (-not $newUrl) { return $false }
  if (-not (Wait-TunnelHealth $newUrl)) { return $false }

  $script:LastTunnelRestart = Get-Date
  $script:PublicFailCount = 0
  $prev = Get-PublishedUrl
  Set-PublishedUrl $newUrl
  if ($prev -ne $newUrl) {
    Push-ServerJson $newUrl
  }
  return $true
}

function Stop-Escuchador {
  Test-AppProcess $escucharMatch | ForEach-Object {
    Write-Keep "kill escuchador pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Send-WatcherOff {
  try {
    $body = '{"status":"off","pendingCount":0}'
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/watcher/beat" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 4 | Out-Null
  } catch {}
}

function Enter-SleepMode {
  Write-Keep 'soft-sleep (escuchador off; tunel+server quedan)'
  Stop-Escuchador
  Send-WatcherOff
}

function Enter-ActiveMode {
  Write-Keep 'activo -> server + escuchador + tunel'
  $null = Ensure-Server
  Ensure-Escuchador
  $null = Ensure-PublicTunnel
}

Write-Keep '=== Once 11 keep-alive iniciado (force | 8-21 | escuchador) ==='
while ($true) {
  try {
    $active = Test-ShouldBeOn
    if ($active -and $script:ModeActive -ne $true) {
      Enter-ActiveMode
      $script:ModeActive = $true
    } elseif (-not $active -and $script:ModeActive -ne $false) {
      Enter-SleepMode
      $script:ModeActive = $false
    } elseif ($active) {
      $null = Ensure-Server
      Ensure-Escuchador
      $null = Ensure-PublicTunnel
    } else {
      $null = Ensure-Server
      $null = Ensure-PublicTunnel
    }
  } catch {
    Write-Keep "loop error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds ($(if (Test-ShouldBeOn) { $pollSecActive } else { $pollSecSleep }))
}
