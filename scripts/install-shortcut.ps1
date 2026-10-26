$ErrorActionPreference = 'Stop'
$launchPath = Join-Path $PSScriptRoot 'launch.ps1'
if (-not (Test-Path -LiteralPath $launchPath -PathType Leaf)) { throw '未找到完整的启动脚本。' }
$desktopDir = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopDir '网易云 · 歌曲知识.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + $launchPath + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = '网易云播放界面的歌曲知识与 DeepSeek API 设置'
$ncmProcess = Get-Process -Name cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ncmProcess -and $ncmProcess.Path) { $shortcut.IconLocation = $ncmProcess.Path + ',0' }
$shortcut.Save()
Write-Output $shortcutPath
