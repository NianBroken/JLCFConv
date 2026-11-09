# 将项目已经安装的 LTS 运行时注册到设备 PATH。
$ErrorActionPreference = 'Stop'
$runtimeDirectory = Join-Path $env:ProgramFiles 'JLCFConv\node'
$runtime = Join-Path $runtimeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $runtime)) { throw '设备级运行时不存在。' }
if (-not (& $runtime -p 'process.release.lts||""')) { throw '设备级运行时必须是 LTS。' }
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (($machinePath -split ';') -notcontains $runtimeDirectory) { [Environment]::SetEnvironmentVariable('Path', $runtimeDirectory + ';' + $machinePath, 'Machine') }
Write-Output '设备级 Node.js LTS PATH 已配置。'
