# Clear supervisor.lock when no live agent is holding work.
# Prefer logs/agent.pid (reliable); fall back to command-line match.
$ErrorActionPreference = 'SilentlyContinue'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lock = Join-Path $agentDir 'logs\supervisor.lock'
$slog = Join-Path $agentDir 'logs\supervisor.log'
$pidFile = Join-Path $agentDir 'logs\agent.pid'
$logDir = Join-Path $agentDir 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Test-AgentAlive {
  if (Test-Path -LiteralPath $pidFile) {
    $raw = (Get-Content -LiteralPath $pidFile -TotalCount 1 | Out-String).Trim()
    if ($raw -match '^\d+$') {
      $p = Get-Process -Id ([int]$raw) -ErrorAction SilentlyContinue
      if ($p) { return $true }
    }
  }
  $hits = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'replay-fetcher[\\/]+src[\\/]+index\.js' -or
      ($_.CommandLine -match 'nodejs\\node\.exe".*src[\\/]+index\.js' -and $_.CommandLine -notmatch 'bilibili')
    )
  })
  return $hits.Count -gt 0
}

if (-not (Test-AgentAlive) -and (Test-Path -LiteralPath $lock)) {
  Remove-Item -LiteralPath $lock -Force
  Add-Content -LiteralPath $slog -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] cleared stale supervisor.lock")
}
