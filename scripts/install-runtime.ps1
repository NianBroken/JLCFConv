# 官方签名与摘要校验通过后，将 LTS 运行时安装至设备公共目录。
$ErrorActionPreference = 'Stop'
$runtimeDirectory = Join-Path $env:ProgramFiles 'JLCFConv\node'
$releaseIndex = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$release = $releaseIndex | Where-Object { $_.lts -and $_.files -contains 'win-x64-exe' } | Select-Object -First 1
$releaseUrl = 'https://nodejs.org/dist/' + $release.version
$temporaryBinary = Join-Path $env:TEMP 'jlcfconv-lts-node.exe'
Invoke-WebRequest ($releaseUrl + '/win-x64/node.exe') -OutFile $temporaryBinary
$checksums = (Invoke-WebRequest ($releaseUrl + '/SHASUMS256.txt')).Content
if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
$checksumLine = ($checksums -split "`n" | Where-Object { $_ -match '\swin-x64/node\.exe\s*$' })
$expectedDigest = ($checksumLine -split '\s+')[0]
if ((Get-FileHash $temporaryBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedDigest) { throw '运行时摘要校验失败。' }
if ((Get-AuthenticodeSignature $temporaryBinary).Status -ne 'Valid') { throw '运行时签名校验失败。' }
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Copy-Item -LiteralPath $temporaryBinary -Destination (Join-Path $runtimeDirectory 'node.exe') -Force
& (Join-Path $runtimeDirectory 'node.exe') -p 'JSON.stringify(process.release)'
# 设备级 PATH 指向经过验证的 LTS 可执行文件，既有工具目录继续保留。
$machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
if (($machinePath -split ';') -notcontains $runtimeDirectory) {
    [Environment]::SetEnvironmentVariable('Path', $runtimeDirectory + ';' + $machinePath, 'Machine')
}
