# 修复文件截断问题（需管理员）：
# 1) 把项目目录加入 Defender 实时扫描排除（消除「编辑器写入瞬间被扫描器锁文件」的竞态）
# 2) 把 Cursor/node/git 进程加入扫描排除
# 3) 查询 NTFS 脏位，判断是否需要 chkdsk
# 结果写入 scripts\_tmp_fix_truncation_result.txt
$out = 'C:\Users\huyuz\Desktop\xcxtest-2\scripts\_tmp_fix_truncation_result.txt'
$log = @()
try {
  Add-MpPreference -ExclusionPath 'C:\Users\huyuz\Desktop\xcxtest-2'
  $log += 'OK: 已排除目录 C:\Users\huyuz\Desktop\xcxtest-2'
} catch { $log += ('FAIL 排除目录: ' + $_.Exception.Message) }

foreach ($p in @('Cursor.exe', 'node.exe', 'git.exe')) {
  try {
    Add-MpPreference -ExclusionProcess $p
    $log += ('OK: 已排除进程 ' + $p)
  } catch { $log += ('FAIL 排除进程 ' + $p + ': ' + $_.Exception.Message) }
}

try {
  $pref = Get-MpPreference
  $log += ('当前排除目录: ' + ($pref.ExclusionPath -join '; '))
  $log += ('当前排除进程: ' + ($pref.ExclusionProcess -join '; '))
} catch { $log += ('FAIL 读取排除: ' + $_.Exception.Message) }

try {
  $dirty = (fsutil dirty query C:) 2>&1 | Out-String
  $log += ('NTFS 脏位: ' + $dirty.Trim())
} catch { $log += ('FAIL fsutil: ' + $_.Exception.Message) }

$log | Set-Content -Path $out -Encoding UTF8
