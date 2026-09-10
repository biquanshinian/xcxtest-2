' Silent watchdog: no console. Task Scheduler must launch via wscript.exe //B //nologo
Option Explicit
Dim fso, sh, dir, logDir, pidFile, hbFile, lockFile, hidden, lastStart, wlog
Dim pids, alive, hbAge, cooldown

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = dir & "\logs"
pidFile = logDir & "\agent.pid"
hbFile = logDir & "\agent.heartbeat"
lockFile = logDir & "\supervisor.lock"
hidden = dir & "\start-agent-hidden.vbs"
lastStart = logDir & "\watchdog.last-start"
wlog = logDir & "\watchdog.log"

If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

Set pids = CollectPids()
alive = (pids.Count > 0)
hbAge = HeartbeatAgeSec()
cooldown = FileAgeSec(lastStart) < 45

If alive And hbAge <= 480 Then WScript.Quit 0
If cooldown Then WScript.Quit 0

If alive And hbAge > 480 Then
  WriteLog "hung heartbeat " & hbAge & "s, restart"
  KillPids pids
  WScript.Sleep 2000
  StartAgent
  WScript.Quit 0
End If

WriteLog "agent down, self-revive"
StartAgent
WScript.Quit 0

Function CollectPids()
  Dim dict, pid, wmi, procs, p, cmd
  Set dict = CreateObject("Scripting.Dictionary")
  If fso.FileExists(pidFile) Then
    pid = ReadFirstLine(pidFile)
    If IsNumeric(pid) Then
      If PidAlive(CLng(pid)) Then dict(CLng(pid)) = 1
    End If
  End If
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'")
  For Each p In procs
    cmd = LCase(CStr(p.CommandLine & ""))
    If InStr(cmd, "replay-fetcher") > 0 Then
      If InStr(cmd, "index.js") > 0 Then
        If Not dict.Exists(CLng(p.ProcessId)) Then dict(CLng(p.ProcessId)) = 1
      End If
    End If
  Next
  On Error GoTo 0
  Set CollectPids = dict
End Function

Function PidAlive(pid)
  Dim wmi, procs
  PidAlive = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId=" & pid)
  If procs.Count > 0 Then PidAlive = True
  On Error GoTo 0
End Function

Function HeartbeatAgeSec()
  HeartbeatAgeSec = 999999
  If fso.FileExists(hbFile) Then HeartbeatAgeSec = FileAgeSec(hbFile)
End Function

Function FileAgeSec(path)
  FileAgeSec = 999999
  If Not fso.FileExists(path) Then Exit Function
  On Error Resume Next
  FileAgeSec = DateDiff("s", fso.GetFile(path).DateLastModified, Now)
  If FileAgeSec < 0 Then FileAgeSec = 0
  On Error GoTo 0
End Function

Function ReadFirstLine(path)
  Dim ts
  ReadFirstLine = ""
  On Error Resume Next
  Set ts = fso.OpenTextFile(path, 1)
  If Not ts.AtEndOfStream Then ReadFirstLine = Trim(ts.ReadLine)
  ts.Close
  On Error GoTo 0
End Function

Sub KillPids(dict)
  Dim key, wmi, procs, p
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  For Each key In dict.Keys
    Set procs = wmi.ExecQuery("SELECT * FROM Win32_Process WHERE ProcessId=" & key)
    For Each p In procs
      p.Terminate
    Next
  Next
  On Error GoTo 0
End Sub

Sub StartAgent()
  On Error Resume Next
  If fso.FileExists(lockFile) Then fso.DeleteFile lockFile, True
  If fso.FileExists(hidden) Then
    sh.Run "wscript.exe //B //nologo """ & hidden & """", 0, False
  End If
  WriteText lastStart, Now
  On Error GoTo 0
End Sub

Sub WriteText(path, text)
  Dim ts
  On Error Resume Next
  Set ts = fso.CreateTextFile(path, True)
  ts.Write CStr(text)
  ts.Close
  On Error GoTo 0
End Sub

Sub WriteLog(msg)
  Dim ts
  On Error Resume Next
  Set ts = fso.OpenTextFile(wlog, 8, True)
  ts.WriteLine "[" & Year(Now) & "-" & Pad(Month(Now)) & "-" & Pad(Day(Now)) & " " & Pad(Hour(Now)) & ":" & Pad(Minute(Now)) & ":" & Pad(Second(Now)) & "] " & msg
  ts.Close
  On Error GoTo 0
End Sub

Function Pad(n)
  If n < 10 Then Pad = "0" & n Else Pad = CStr(n)
End Function
