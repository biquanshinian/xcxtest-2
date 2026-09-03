# Install user-level autostart + 2-minute watchdog for replay-fetcher (no admin required)
param(
  [switch]$NoPrompt,
  [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $agentDir 'start-agent.bat'
$watchdog = Join-Path $agentDir 'watchdog-silent.vbs'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$link = Join-Path $startup 'ReplayFetcherAgent.vbs'
$taskName = 'ReplayFetcherWatchdog'
$logDir = Join-Path $agentDir 'logs'

if (-not (Test-Path -LiteralPath $bat)) {
  Write-Host '[ERROR] Missing start-agent.bat'
  exit 1
}
if (-not (Test-Path -LiteralPath $watchdog)) {
  Write-Host '[ERROR] Missing watchdog-silent.vbs'
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $fallback = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $fallback) {
    $node = Get-Item -LiteralPath $fallback
  }
}
if (-not $node) {
  Write-Host '[ERROR] node.exe not found. Install Node.js first.'
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $agentDir '.env'))) {
  Write-Host '[WARN] .env not found. Copy .env.example to .env first.'
  Write-Host ''
}

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$nodePath = if ($node.Source) { $node.Source } else { $node.FullName }
Set-Content -LiteralPath (Join-Path $logDir 'node-path.txt') -Value $nodePath -Encoding ASCII

if (-not (Test-Path -LiteralPath $startup)) {
  New-Item -ItemType Directory -Path $startup -Force | Out-Null
}

$escBat = $bat.Replace('\', '\\')
$escLog = $logDir.Replace('\', '\\')
$vbs = @"
Option Explicit
Dim sh, fso, bat, logDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
bat = "$escBat"
logDir = "$escLog"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
If fso.FileExists(bat) Then sh.Run """" & bat & """", 0, False
"@
Set-Content -LiteralPath $link -Value $vbs -Encoding ASCII

$tr = 'wscript.exe //B //nologo "' + $watchdog + '"'
$create = schtasks /Create /TN $taskName /SC MINUTE /MO 2 /F /RL LIMITED /TR $tr
if ($LASTEXITCODE -ne 0) {
  Write-Host '[WARN] Scheduled task create failed; Startup shortcut is still installed.'
  Write-Host $create
} else {
  Write-Host "Watchdog task: $taskName (every 2 minutes, silent wscript)"
}

Write-Host 'OK. Autostart + self-revive installed for this Windows user.'
Write-Host "Startup file: $link"
Write-Host "Agent dir:    $agentDir"
Write-Host "Node:         $nodePath"
Write-Host "Log file:     $(Join-Path $logDir 'agent.log')"
Write-Host ''

$shouldStart = $StartNow
if (-not $NoPrompt -and -not $StartNow) {
  $ans = Read-Host 'Run once now? [Y/N]'
  $shouldStart = $ans -match '^[Yy]'
}
if ($shouldStart) {
  Write-Host 'Starting...'
  $hidden = Join-Path $agentDir 'start-agent-hidden.vbs'
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$hidden`""
  Start-Sleep -Seconds 2
  Write-Host 'Started. Check logs\agent.log'
}

Write-Host ''
Write-Host 'To remove autostart: run uninstall-autostart.bat'
