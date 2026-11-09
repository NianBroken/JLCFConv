# 此脚本在计算机证书存储中维护项目专用证书链，私钥仅供本机服务读取。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$tlsDirectory = Join-Path $env:ProgramData 'JLCFConv\tls'
$certificateName = 'JLCFConv Local CA'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'HTTPS 证书配置需要管理员进程。' }
New-Item -ItemType Directory -Force -Path $tlsDirectory | Out-Null
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|VPN|Clash' } | Select-Object -ExpandProperty IPAddress -Unique)
if ($addresses.Count -eq 0) { throw '未找到可用于局域网访问的 IPv4 地址。' }
$root = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq "CN=$certificateName" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
if (-not $root) {
  $root = New-SelfSignedCertificate -Type Custom -Subject "CN=$certificateName" -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5)
}
$rootFile = Join-Path $tlsDirectory 'root-ca.cer'
Export-Certificate -Cert $root -FilePath $rootFile -Type CERT | Out-Null
if (-not (Test-Path "Cert:\LocalMachine\Root\$($root.Thumbprint)")) { Import-Certificate -FilePath $rootFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null }
$san = '2.5.29.17={text}DNS=localhost&DNS=' + $env:COMPUTERNAME + '&' + (($addresses | ForEach-Object { 'IPAddress=' + $_ }) -join '&')
$leaf = New-SelfSignedCertificate -Type Custom -Subject 'CN=JLCFConv HTTPS' -Signer $root -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @($san,'2.5.29.37={text}1.3.6.1.5.5.7.3.1') -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddDays(365)
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($leaf)
try { [IO.File]::WriteAllText((Join-Path $tlsDirectory 'server-key.pem'), $rsa.ExportPkcs8PrivateKeyPem(), [Text.UTF8Encoding]::new($false)) } finally { $rsa.Dispose() }
[IO.File]::WriteAllText((Join-Path $tlsDirectory 'server-cert.pem'), $leaf.ExportCertificatePem() + "`n" + $root.ExportCertificatePem(), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $tlsDirectory 'root-ca.pem'), $root.ExportCertificatePem(), [Text.UTF8Encoding]::new($false))
$acl = Get-Acl -LiteralPath $tlsDirectory
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }
$readerRule = [Security.AccessControl.FileSystemAccessRule]::new($identity.User,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($readerRule)
Set-Acl -LiteralPath $tlsDirectory -AclObject $acl
@{ tlsDirectory=$tlsDirectory; addresses=$addresses; certificateThumbprint=$leaf.Thumbprint; rootThumbprint=$root.Thumbprint } | ConvertTo-Json
