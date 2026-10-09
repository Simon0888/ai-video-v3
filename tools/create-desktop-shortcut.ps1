# Save a desktop entry for this checkout; no logon startup or global settings.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskConfig = [IO.File]::ReadAllText((Join-Path $taskRoot '.local\engine.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
$taskTitle = @([char]0x542F,[char]0x52A8,[char]0x9020,[char]0x7247,[char]0x672C,[char]0x673A,[char]0x7248) -join ''
$taskDesktop = [Environment]::GetFolderPath('Desktop')
$taskShortcutPath = Join-Path $taskDesktop ($taskTitle + '.lnk')
if (Test-Path -LiteralPath $taskShortcutPath) { throw 'A shortcut with this name already exists. Inspect it before replacing it.' }
$taskShell = New-Object -ComObject WScript.Shell
$taskLink = $taskShell.CreateShortcut($taskShortcutPath)
$taskNodeEscaped = $taskConfig.node.Replace("'","''")
$taskScriptEscaped = (Join-Path $taskRoot 'tools\start-local.mjs').Replace("'","''")
$taskLink.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskLink.Arguments = '-NoProfile -WindowStyle Hidden -Command "& ''' + $taskNodeEscaped + ''' ''' + $taskScriptEscaped + '''"'
$taskLink.WorkingDirectory = $taskRoot
$taskLink.Description = 'Start Zaopian local video processing'
$taskLink.WindowStyle = 7
$taskLink.Save()
Write-Host ('Saved desktop shortcut: ' + $taskShortcutPath)

