# Install user-level autostart for bilibili-publisher (no admin required)
$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $agentDir 'start-agent.bat'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$link = Join-Path $startup 'BilibiliPublisherAgent.vbs'
$oldCmd = Join-Path $startup 'BilibiliPublisherAgent.cmd'

if (-not (Test-Path -LiteralPath $bat)) {
  Write-Host '[ERROR] Missing start-agent.bat'
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[ERROR] node.exe not found in PATH. Install Node.js first.'
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $agentDir '.env'))) {
  Write-Host '[WARN] .env not found. Copy .env.example to .env and set BILI_AGENT_TOKEN.'
  Write-Host ''
}

if (-not (Test-Path -LiteralPath $startup)) {
  New-Item -ItemType Directory -Path $startup -Force | Out-Null
}

$logDir = Join-Path $agentDir 'logs'
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

if (Test-Path -LiteralPath $oldCmd) {
  Remove-Item -LiteralPath $oldCmd -Force
}

Write-Host 'OK. Autostart installed for this Windows user.'
Write-Host "Startup file: $link"
Write-Host "Agent dir:    $agentDir"
Write-Host "Log file:     $(Join-Path $logDir 'agent.log')"
Write-Host ''

$ans = Read-Host 'Run once now? [Y/N]'
if ($ans -match '^[Yy]') {
  Write-Host 'Starting...'
  $hidden = Join-Path $agentDir 'start-agent-hidden.vbs'
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$hidden`""
  Start-Sleep -Seconds 2
  Write-Host 'Started. Check logs\agent.log'
}

Write-Host ''
Write-Host 'To remove autostart: run uninstall-autostart.bat'
