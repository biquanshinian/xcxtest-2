' Hidden launcher for Bilibili publisher agent (used by Task Scheduler)
Option Explicit
Dim sh, fso, dir, bat, logDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
bat = dir & "\start-agent.bat"
logDir = dir & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
sh.Run """" & bat & """", 0, False
