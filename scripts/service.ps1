# Windows 计划任务维护 HTTPS 服务，所有进程使用设备级 LTS 运行时。
param([ValidateSet('Install','Run','Stop','Status','Restart')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$projectDirectory = Split-Path -Parent $PSScriptRoot
$taskName = 'JLCFConv-HTTPS'
$runtime = Join-Path $env:ProgramFiles 'JLCFConv\node\node.exe'
$runtimeDirectory = Join-Path $projectDirectory '.runtime'
$infoPath = Join-Path $runtimeDirectory 'service.json'
$scriptPath = $PSCommandPath
$shellPath = (Get-Command pwsh).Source
if ($Action -eq 'Run') {
    Set-Location -LiteralPath $projectDirectory
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    if (-not (Test-Path -LiteralPath $runtime)) { throw '设备级 Node.js LTS 运行时不存在。' }
    $release = & $runtime -p 'process.release.lts||""'
    if (-not $release) { throw '服务需要 Node.js LTS。' }
    # 每轮进程拥有独立日志，保留错误信息与退出码用于核验。
    while ($true) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $process = Start-Process -FilePath $runtime -ArgumentList 'dist-server/main.js' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "$stamp-service.log") -RedirectStandardError (Join-Path $runtimeDirectory "$stamp-error.log") -PassThru
        $process.WaitForExit()
        Add-Content -LiteralPath (Join-Path $runtimeDirectory 'supervisor.log') -Value "$(Get-Date -Format o) 进程退出，退出码 $($process.ExitCode)" -Encoding UTF8
        Start-Sleep -Seconds 3
    }
}
if ($Action -eq 'Status') {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { $task | Select-Object TaskName,State }
    if (Test-Path -LiteralPath $infoPath) {
        $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $process = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
        [pscustomobject]@{ Running = [bool]$process; ProcessId = $info.pid; Url = $info.urls -join ', '; Runtime = $info.runtime; LTS = $info.lts }
    }
    exit
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '计划任务与局域网防火墙配置需要管理员进程。' }
if ($Action -eq 'Restart') {
    $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $targetProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
    if (-not $targetProcess -or $targetProcess.ExecutablePath -ne $runtime -or $targetProcess.CommandLine -notmatch 'dist-server/main.js') { throw '运行进程与项目服务不一致。' }
    Stop-Process -Id $info.pid -Force
    Write-Output '服务进程已结束，后台监督任务负责重新启动。'
    exit
}
if ($Action -eq 'Stop') {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
    if (Test-Path -LiteralPath $infoPath) {
        $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $targetProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
        if ($targetProcess -and $targetProcess.ExecutablePath -eq $runtime -and $targetProcess.CommandLine -match 'dist-server/main.js') { Stop-Process -Id $info.pid -Force }
    }
    exit
}
$taskAction = New-ScheduledTaskAction -Execute $shellPath -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Action Run" -WorkingDirectory $projectDirectory
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
if (-not (Get-NetFirewallRule -DisplayName 'JLCFConv HTTPS LAN' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'JLCFConv HTTPS LAN' -Direction Inbound -Action Allow -Program $runtime -Protocol TCP -RemoteAddress LocalSubnet -Profile Any | Out-Null
}
Start-ScheduledTask -TaskName $taskName
Write-Output 'JLCFConv HTTPS 后台服务已启动。'
