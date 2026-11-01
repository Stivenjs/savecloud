$ErrorActionPreference = "Stop"
$utf8Encoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding
$envPath = Join-Path (Get-Location) ".env"
$examplePath = Join-Path (Get-Location) ".env.docker.example"

function Get-EnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Test-Path -LiteralPath $envPath)) { return "" }
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$") {
      return $Matches[1].Trim('"', "'")
    }
  }
  return ""
}

function Set-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $lines = if (Test-Path -LiteralPath $envPath) { @(Get-Content -LiteralPath $envPath) } else { @() }
  $pattern = "^\s*$([regex]::Escape($Name))\s*="
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = "$Name=$Value"
      $found = $true
    }
  }
  if (-not $found) { $lines += "$Name=$Value" }
  [System.IO.File]::WriteAllLines($envPath, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))
}

function New-HexSecret {
  param([int]$ByteCount = 32)
  $bytes = [byte[]]::new($ByteCount)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Test-DomainName {
  param([string]$Value)
  if ($Value.Length -gt 253 -or $Value -notmatch '^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$') {
    return $false
  }
  return $true
}

function Read-DomainName {
  while ($true) {
    $value = (Read-Host "Dominio que usarás para SaveCloud, por ejemplo savecloud.example.com").Trim().TrimEnd('.')
    if (Test-DomainName $value) { return $value.ToLowerInvariant() }
    Write-Host "Escribe un dominio sin https://, ruta ni puerto (por ejemplo savecloud.example.com)." -ForegroundColor Yellow
  }
}

function Read-PublicIpv4 {
  while ($true) {
    $value = (Read-Host "IP pública IPv4 del VPS (la encuentras en el panel de tu proveedor)").Trim()
    $parsed = $null
    if ([System.Net.IPAddress]::TryParse($value, [ref]$parsed) -and $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
      return $value
    }
    Write-Host "Escribe una dirección IPv4 pública, por ejemplo 203.0.113.25." -ForegroundColor Yellow
  }
}

function Read-CloudflareTunnelToken {
  $token = Get-EnvValue "CLOUDFLARE_TUNNEL_TOKEN"
  if ($token -and $token -notmatch '^(replace-with-|yourcloudflare)') { return $token }

  $secureToken = Read-Host "Pega solo el valor del token de Cloudflare (entrada oculta; no pegues el comando Docker)" -AsSecureString
  if ($secureToken.Length -eq 0) { throw "El token de Cloudflare Tunnel es obligatorio para el modo túnel." }

  $tokenPointer = [IntPtr]::Zero
  try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  } finally {
    if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    $secureToken.Dispose()
  }

  Set-EnvValue "CLOUDFLARE_TUNNEL_TOKEN" $token
  return $token
}

if (-not (Test-Path -LiteralPath $envPath)) {
  if (-not (Test-Path -LiteralPath $examplePath)) { throw "No se encontró .env.docker.example en la raíz del repositorio." }
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "Se creó .env desde .env.docker.example."
}

Write-Host ""
Write-Host "Asistente de instalación Docker de SaveCloud"
Write-Host "  1. Local: para probar en esta computadora. No requiere dominio."
Write-Host "  2. VPS: para publicar en un servidor con IP pública; requiere dominio y puertos TCP 80/443."
Write-Host "  3. Cloudflare Tunnel: para publicar sin abrir puertos entrantes. Requiere un dominio activo en Cloudflare."
do {
  $choice = (Read-Host "Elige 1, 2 o 3").Trim()
} while ($choice -notin @("1", "2", "3"))

if ($choice -eq "1") {
  $deploymentMode = "local"
  $domain = "localhost"
  $s3Endpoint = "http://localhost:9000"
  $logLevel = "info"
  $httpRequestLogs = "true"
  $apiPort = Get-EnvValue "API_PORT"
  if (-not $apiPort) { $apiPort = "3000" }
  Write-Host ""
  Write-Host "Modo local: la API y S3 estarán disponibles solo en esta computadora."
} elseif ($choice -eq "2") {
  $deploymentMode = "vps"
  $domain = Read-DomainName
  $publicIpv4 = Read-PublicIpv4
  $s3Endpoint = "https://s3.$domain"
  $logLevel = "warn"
  $httpRequestLogs = "false"
  $apiPort = Get-EnvValue "API_PORT"
  if (-not $apiPort) { $apiPort = "3000" }

  Write-Host ""
  Write-Host "Antes del HTTPS automático, configura estos DNS en el panel de tu dominio:"
  Write-Host "  Registro A   Host @    Apunta a: $publicIpv4"
  Write-Host "  Registro A   Host s3   Apunta a: $publicIpv4"
  Write-Host "No añadas https://, puerto ni ruta en los registros DNS."
  Write-Host "Abre TCP 80 y 443 en el firewall del VPS y del proveedor. UDP 443 es opcional."
  $dnsReady = (Read-Host "¿Ya configuraste esos DNS y puertos? (S/N)").Trim()
  if ($dnsReady -notmatch '^(s|si|sí|y|yes)$') {
    Write-Host "Puedes continuar, pero Caddy no obtendrá los certificados hasta que DNS y firewall estén listos." -ForegroundColor Yellow
  }
} else {
  $deploymentMode = "cloudflare"
  $domain = Read-DomainName
  $s3Endpoint = "https://s3.$domain"
  $logLevel = "warn"
  $httpRequestLogs = "false"
  $apiPort = Get-EnvValue "API_PORT"
  if (-not $apiPort) { $apiPort = "3000" }

  Write-Host ""
  Write-Host "Prepara Cloudflare antes de continuar:"
  Write-Host "  1. Comprueba que la zona $domain esté Activa en Cloudflare. Cambiar los nameservers basta; transferir el dominio es opcional."
  Write-Host "  2. En Conexión de red → Túneles, crea un túnel y agrega estas aplicaciones publicadas:"
  Write-Host "       $domain     → http://caddy:80"
  Write-Host "       s3.$domain  → http://caddy:80"
  Write-Host "     Conserva el Host Header público de cada hostname."
  Write-Host "  3. En las instrucciones Docker, copia solo el valor después de --token. No ejecutes el comando docker run: este asistente inicia el túnel."
  Write-Host "No necesitas una IP pública fija ni abrir puertos entrantes."
  $routesReady = (Read-Host "¿Ya creaste el túnel y configuraste los dos hostnames? (S/N)").Trim()
  if ($routesReady -notmatch '^(s|si|sí|y|yes)$') {
    Write-Host "Puedes continuar; termina esas rutas en Cloudflare para que los hostnames sean accesibles." -ForegroundColor Yellow
  }
  [void](Read-CloudflareTunnelToken)
}

Set-EnvValue "DEPLOYMENT_MODE" $deploymentMode
Set-EnvValue "DOMAIN" $domain
Set-EnvValue "S3_PUBLIC_ENDPOINT" $s3Endpoint
Set-EnvValue "API_PORT" $apiPort
Set-EnvValue "LOG_LEVEL" $logLevel
Set-EnvValue "HTTP_REQUEST_LOGS" $httpRequestLogs

$apiKey = Get-EnvValue "SYNC_GAMES_API_KEY"
if (-not $apiKey -or $apiKey -match '^replace-with-' -or $apiKey -eq "sg_secret_key_12345") {
  $apiKey = "sc_$(New-HexSecret)"
  Set-EnvValue "SYNC_GAMES_API_KEY" $apiKey
}

$accessTokenSecret = Get-EnvValue "ACCESS_TOKEN_SECRET"
if (-not $accessTokenSecret -or $accessTokenSecret -match '^replace-with-' -or $accessTokenSecret -eq $apiKey) {
  do {
    $accessTokenSecret = New-HexSecret
  } while ($accessTokenSecret -eq $apiKey)
  Set-EnvValue "ACCESS_TOKEN_SECRET" $accessTokenSecret
}

$objectUser = Get-EnvValue "OBJECT_STORAGE_ACCESS_KEY"
if (-not $objectUser -or $objectUser -match '^replace-with-' -or $objectUser -eq "minioadmin") {
  $objectUser = "savecloud_$(New-HexSecret -ByteCount 8)"
  Set-EnvValue "OBJECT_STORAGE_ACCESS_KEY" $objectUser
}

$objectSecret = Get-EnvValue "OBJECT_STORAGE_SECRET_KEY"
if (-not $objectSecret -or $objectSecret -match '^replace-with-' -or $objectSecret -eq "minioadmin") {
  Set-EnvValue "OBJECT_STORAGE_SECRET_KEY" (New-HexSecret)
}

$databasePassword = Get-EnvValue "DATABASE_PASSWORD"
if (-not $databasePassword -or $databasePassword -match '^replace-with-') {
  $databasePassword = New-HexSecret
  Set-EnvValue "DATABASE_PASSWORD" $databasePassword
}

$licensePath = Get-EnvValue "MINIO_LICENSE_PATH"
if (-not $licensePath) { $licensePath = "./minio.license" }
$resolvedLicensePath = if ([System.IO.Path]::IsPathRooted($licensePath)) { $licensePath } else { Join-Path (Get-Location) $licensePath }
while (-not (Test-Path -LiteralPath $resolvedLicensePath -PathType Leaf)) {
  Write-Host "MinIO AIStor necesita una licencia para iniciar. Descárgala desde https://www.min.io/pricing." -ForegroundColor Yellow
  Write-Host "Escribe la ruta del archivo minio.license que descargaste."
  $licensePath = (Read-Host "Escribe la ruta al archivo de licencia (Enter para ./minio.license)").Trim()
  if (-not $licensePath) { $licensePath = "./minio.license" }
  $resolvedLicensePath = if ([System.IO.Path]::IsPathRooted($licensePath)) { $licensePath } else { Join-Path (Get-Location) $licensePath }
}
$licensePath = $resolvedLicensePath.Replace('\', '/')
Set-EnvValue "MINIO_LICENSE_PATH" $licensePath

$env:DOMAIN = $domain
$env:DEPLOYMENT_MODE = $deploymentMode
$env:S3_PUBLIC_ENDPOINT = $s3Endpoint
$env:API_PORT = $apiPort
$env:LOG_LEVEL = $logLevel
$env:HTTP_REQUEST_LOGS = $httpRequestLogs
$env:SYNC_GAMES_API_KEY = $apiKey
$env:ACCESS_TOKEN_SECRET = $accessTokenSecret
$env:OBJECT_STORAGE_ACCESS_KEY = $objectUser
$env:OBJECT_STORAGE_SECRET_KEY = $objectSecret
$env:DATABASE_PASSWORD = $databasePassword
$env:MINIO_LICENSE_PATH = $licensePath

Write-Host ""
Write-Host "Configuración guardada en .env. La clave de API para la aplicación SaveCloud es:"
Write-Host $apiKey -ForegroundColor Cyan
Write-Host "Cópiala ahora en Configuración → Conexión de servidor. No la pegues en chats ni compartas capturas que la muestren."
Write-Host ""

if ($choice -eq "2" -or $choice -eq "3") {
  Write-Host "Dominio API: https://$domain"
  Write-Host "Dominio S3:  $s3Endpoint"
  Write-Host ""
}

& (Join-Path $PSScriptRoot "docker-up.ps1")
exit $LASTEXITCODE
