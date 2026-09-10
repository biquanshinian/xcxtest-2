# 诊断：文件被截断为 0 字节 / ftruncate UNKNOWN 错误的可能根因
$ErrorActionPreference = 'Continue'

Write-Host '=== 1. Defender 状态 ==='
try {
  $st = Get-MpComputerStatus
  Write-Host ("RealTimeProtection: " + $st.RealTimeProtectionEnabled)
  Write-Host ("AntivirusEnabled:   " + $st.AntivirusEnabled)
} catch { Write-Host ("读取失败: " + $_.Exception.Message) }

Write-Host ''
Write-Host '=== 2. 受控文件夹访问（勒索软件防护，会拦截对桌面的写入） ==='
try {
  $pref = Get-MpPreference
  Write-Host ("EnableControlledFolderAccess: " + $pref.EnableControlledFolderAccess + "  (0=关 1=开 2=审计)")
  Write-Host '受保护文件夹:'
  $pref.ControlledFolderAccessProtectedFolders | ForEach-Object { Write-Host ("  " + $_) }
  Write-Host '允许的应用:'
  $pref.ControlledFolderAccessAllowedApplications | ForEach-Object { Write-Host ("  " + $_) }
  Write-Host 'Defender 排除目录:'
  $pref.ExclusionPath | ForEach-Object { Write-Host ("  " + $_) }
} catch { Write-Host ("读取失败: " + $_.Exception.Message) }

Write-Host ''
Write-Host '=== 3. 已安装的杀毒产品 ==='
try {
  Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct |
    ForEach-Object { Write-Host ("  " + $_.displayName + "  state=" + $_.productState) }
} catch { Write-Host ("读取失败: " + $_.Exception.Message) }

Write-Host ''
Write-Host '=== 4. 磁盘空间 ==='
Get-PSDrive C | ForEach-Object {
  $freeGB = [math]::Round($_.Free / 1GB, 1)
  $usedGB = [math]::Round($_.Used / 1GB, 1)
  Write-Host ("  C: used=" + $usedGB + "GB free=" + $freeGB + "GB")
}

Write-Host ''
Write-Host '=== 5. NTFS 脏位（是否需要 chkdsk） ==='
try { fsutil dirty query C: } catch { Write-Host ("读取失败: " + $_.Exception.Message) }

Write-Host ''
Write-Host '=== 6. 最近 Defender 拦截记录（受控文件夹访问事件 1123） ==='
try {
  Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-Windows Defender/Operational'; Id=1123 } -MaxEvents 5 -ErrorAction Stop |
    ForEach-Object { Write-Host ("  [" + $_.TimeCreated + "] " + ($_.Message -split "`n" | Select-Object -First 3) -join ' | ') }
} catch { Write-Host ("  无记录或读取失败: " + $_.Exception.Message) }
