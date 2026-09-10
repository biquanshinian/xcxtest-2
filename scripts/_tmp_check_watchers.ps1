# 检查正在监视/占用项目文件的进程
$procs = Get-Process | Where-Object { $_.ProcessName -match 'wechat|devtool|weixin' }
if ($procs) {
  Write-Host '微信相关进程:'
  $procs | Group-Object ProcessName | ForEach-Object { Write-Host ("  " + $_.Name + " x" + $_.Count) }
} else {
  Write-Host '未发现微信开发者工具进程'
}
Write-Host ''
Get-Process | Where-Object { $_.ProcessName -eq 'node' -or $_.ProcessName -eq 'Cursor' } |
  Group-Object ProcessName | ForEach-Object { Write-Host ($_.Name + " x" + $_.Count) }
