param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$bridgePath = Join-Path $projectDir 'src\bridge.mjs'
$launchStage = '检查运行环境'
$dataDir = Join-Path $env:LOCALAPPDATA 'NcmSongKnowledge'

function Write-LaunchLog([string]$event) {
    try {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        Add-Content -LiteralPath (Join-Path $dataDir 'launch.log') -Value ((Get-Date).ToUniversalTime().ToString('o') + ' ' + $event) -Encoding UTF8
    } catch {}
}

function Show-LaunchMessage([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, '网易云 · 歌曲知识', 'OK', 'Information') | Out-Null
}

function Test-DebugPortOccupied {
    $connection = New-Object System.Net.Sockets.TcpClient
    try {
        $pendingConnection = $connection.ConnectAsync('127.0.0.1', 9227)
        return ($pendingConnection.Wait(500) -and $connection.Connected)
    } catch { return $false }
    finally { $connection.Dispose() }
}

try {
    Write-LaunchLog 'launcher-started'
    . (Join-Path $PSScriptRoot 'store-activation.ps1')
    $nodeCandidates = @(
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    $nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $nodePath) { throw '未找到 Node.js。请安装 Node.js 24 或更新版本后重试。' }
    $nodeVersion = & $nodePath --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw '歌曲知识需要 Node.js 24 或更新版本。' }
    if (-not (Test-Path -LiteralPath $bridgePath)) { throw '连接器文件不完整，请重新解压完整项目目录。' }
    if ($CheckOnly) {
        Write-LaunchLog 'preflight-ready'
        [pscustomobject]@{ ok = $true; nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0]); activationHelper = $true } | ConvertTo-Json -Compress
        exit 0
    }

    $debugTargets = $null
    try { $debugTargets = Invoke-RestMethod 'http://127.0.0.1:9227/json/list' -TimeoutSec 2 } catch {}
    $ready = @($debugTargets | Where-Object { $_.type -eq 'page' -and $_.url -match '^orpheus://orpheus/pub/app\.html(?:[?#]|$)' }).Count -gt 0
    if (-not $ready -and (Test-DebugPortOccupied)) {
        Show-LaunchMessage "本机端口 9227 已有服务占用，但未找到网易云主页面。`r`n`r`n请先关闭占用此端口的其他程序或调试服务，再重新打开「网易云 · 歌曲知识」。此次未启动或关闭任何程序。"
        exit 3
    }
    $running = @(Get-Process -Name cloudmusic -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0 -and -not $ready) {
        Show-LaunchMessage "请先右键系统托盘中的网易云图标，选择「退出网易云音乐」。`r`n`r`n然后再次双击「网易云 · 歌曲知识」。关闭主窗口通常只会最小化到托盘。"
        exit 1
    }
    if (-not $ready) {
        $launchStage = '查找网易云启动入口'
        $ncmCandidates = @()
        $storePackages = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq '1F8B0F94.122165AE053F' })
        foreach ($registryPath in @('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe')) {
            if (Test-Path $registryPath) { $ncmCandidates += (Get-Item $registryPath).GetValue('') }
        }
        $ncmArguments = '--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1'
        if ($storePackages.Count -gt 0) {
            $launchStage = '启动商店版网易云'
            Write-LaunchLog 'activating-store'
            $storeTarget = Get-NcmStoreLaunchTarget -Package $storePackages[0]
            Start-NcmStoreApplication -AppUserModelId $storeTarget.AppUserModelId -Arguments $ncmArguments
        } else {
            $ncmPath = $ncmCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
            if (-not $ncmPath) { throw '未找到网易云音乐安装目录。请先安装或启动一次网易云。' }
            $launchStage = '启动桌面版网易云'
            Write-LaunchLog 'starting-desktop'
            Start-Process -FilePath $ncmPath -ArgumentList $ncmArguments -WindowStyle Hidden
        }
        $launchStage = '等待歌曲知识页面接口'
        Write-LaunchLog 'waiting-for-page'
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            try {
                $debugTargets = Invoke-RestMethod 'http://127.0.0.1:9227/json/list' -TimeoutSec 1
                $ready = @($debugTargets | Where-Object { $_.type -eq 'page' -and $_.url -match '^orpheus://orpheus/pub/app\.html(?:[?#]|$)' }).Count -gt 0
                if ($ready) { break }
            } catch {}
        }
        if (-not $ready) {
            Write-LaunchLog 'page-unavailable'
            Show-LaunchMessage "当前网易云版本未开放歌曲知识所需的页面接口。`r`n`r`n网易云可以继续正常使用。请将本机版本号和此提示提供给开发者以继续适配。"
            exit 2
        }
    }
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $launchStage = '启动歌曲知识连接器'
    Start-Process -FilePath $nodePath -ArgumentList ('"' + $bridgePath + '"') -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardError (Join-Path $dataDir 'launch-error.log')
    Write-LaunchLog 'bridge-started'
} catch {
    Write-LaunchLog ('launcher-failed stage={0} hresult={1}' -f $launchStage, $_.Exception.HResult)
    if ($CheckOnly) { throw }
    Show-LaunchMessage ("在「{0}」时失败：`r`n{1}" -f $launchStage, $_.Exception.Message)
    exit 1
}
