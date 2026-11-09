# 管理员只读核验计划任务、证书链、局域网规则和服务进程。
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$info = Get-Content -LiteralPath (Join-Path $projectDirectory '.runtime\service.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$task = Get-ScheduledTask -TaskName 'JLCFConv-HTTPS'
$details = Get-ScheduledTaskInfo -TaskName 'JLCFConv-HTTPS'
$rule = Get-NetFirewallRule -DisplayName 'JLCFConv HTTPS LAN'
$root = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -eq 'CN=JLCFConv Local CA' | Select-Object -First 1
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
$report = [pscustomobject]@{ TaskState = [string]$task.State; TaskUser = $task.Principal.UserId; LastTaskResult = $details.LastTaskResult; FirewallEnabled = [string]$rule.Enabled; RootTrusted = [bool]$root; RootExpires = $root.NotAfter.ToString('o'); Executable = $process.ExecutablePath; Runtime = $info.runtime; LTS = $info.lts; Url = $info.urls[0]; ProcessId = $info.pid; CheckedAt = (Get-Date).ToString('o') }
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectDirectory 'test-results\service-report.json') -Encoding UTF8
