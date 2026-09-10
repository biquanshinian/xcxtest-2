# Replay-fetcher watchdog: if the agent process is dead or wedged, start it again.
# Designed to run every 2 minutes from Task Scheduler (no window).
$ErrorActionPreference = 'SilentlyContinue'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $agentDir 'logs'
$wlog = Join-Path $logDir 'watchdog.log'
$pidFile = Join-Path $logDir 'agent.pid'
$hbFile = Join-Path $logDir 'agent.heartbeat'
$lock = Join-Path $logDir 'supervisor.lock'
$hidden = Join-Path $agentDir 'start-agent-hidden.vbs'
$clearLock = Join-Path $agentDir 'clear-stale-lock.ps1'
$hbStaleMs = 8 * 60 * 1000
$restartCooldownSec = 45

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-WatchLog([string]$msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  Add-Content -LiteralPath $wlog -Value $line -Encoding UTF8
}

function Get-AgentPids {
  $ids = @()
  if (Test-Path -LiteralPath $pidFile) {
    $raw = (Get-Content -LiteralPath $pidFile -TotalCount 1 | Out-String).Trim()
    if ($raw -match '^\d+$') {
      $p = Get-Process -Id ([int]$raw) -ErrorAction SilentlyContinue
      if ($p) { $ids += [int]$raw }
    }
  }
  $hits = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'replay-fetcher[\\/]+src[\\/]+index\.js' -or
      ($_.CommandLine -match 'nodejs\\node\.exe".*src[\\/]+index\.js' -and $_.CommandLine -notmatch 'bilibili')
    )
  })
  foreach ($h in $hits) {
    $id = [int]$h.ProcessId
    if ($ids -notcontains $id) { $ids += $id }
  }
  return $ids
}

function Get-HeartbeatAgeMs {
  if (-not (Test-Path -LiteralPath $hbFile)) { return [int64]::MaxValue }
  try {
    $first = (Get-Content -LiteralPath $hbFile -TotalCount 1 | Out-String).Trim()
    if ($first -match '^\d+$') {
      $ts = [int64]$first
      if ($ts -gt 1000000000000) { return [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $ts) }
    }
  } catch {}
  $age = (Get-Date) - (Get-Item -LiteralPath $hbFile).LastWriteTime
  return [int64]($age.TotalMilliseconds)
}

function Stop-AgentPids([int[]]$ids) {
  foreach ($id in $ids) {
    try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Start-Agent {
  if (Test-Path -LiteralPath $clearLock) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File', $clearLock) -WindowStyle Hidden -Wait
  }
  if (Test-Path -LiteralPath $lock) {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $hidden)) {
    Write-WatchLog 'ERROR missing start-agent-hidden.vbs'
    return
  }
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$hidden`"" -WindowStyle Hidden
  Set-Content -LiteralPath (Join-Path $logDir 'watchdog.last-start') -Value (Get-Date).ToString('o') -Encoding ASCII
}

function Test-RecentlyStarted {
  $f = Join-Path $logDir 'watchdog.last-start'
  if (-not (Test-Path -LiteralPath $f)) { return $false }
  $age = (Get-Date) - (Get-Item -LiteralPath $f).LastWriteTime
  return $age.TotalSeconds -lt $restartCooldownSec
}

$pids = @(Get-AgentPids)
$alive = $pids.Count -gt 0
$hbAge = Get-HeartbeatAgeMs

if ($alive -and $hbAge -le $hbStaleMs) {
  exit 0
}

if (Test-RecentlyStarted) {
  exit 0
}

if ($alive -and $hbAge -gt $hbStaleMs) {
  Write-WatchLog ("hung heartbeat " + [int]($hbAge / 1000) + "s pids=" + ($pids -join ','))
  Stop-AgentPids $pids
  Start-Sleep -Seconds 2
  Start-Agent
  Write-WatchLog 'restarted after hung heartbeat'
  exit 0
}

Write-WatchLog 'agent down, self-revive'
Start-Agent
exit 0
