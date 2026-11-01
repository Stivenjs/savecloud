$ErrorActionPreference = "Stop"
$utf8Encoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding

$deploymentMode = $env:DEPLOYMENT_MODE
$domain = $env:DOMAIN
$s3PublicEndpoint = $env:S3_PUBLIC_ENDPOINT
$apiPort = $env:API_PORT
$tunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN
if (Test-Path -LiteralPath ".env") {
  foreach ($line in Get-Content -LiteralPath ".env") {
    if ($line -match '^\s*(DEPLOYMENT_MODE|DOMAIN|S3_PUBLIC_ENDPOINT|API_PORT|CLOUDFLARE_TUNNEL_TOKEN)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2].Trim('"', "'")
      switch ($key) {
        "DEPLOYMENT_MODE" { if (-not $deploymentMode) { $deploymentMode = $value } }
        "DOMAIN" { if (-not $domain) { $domain = $value } }
        "S3_PUBLIC_ENDPOINT" { if (-not $s3PublicEndpoint) { $s3PublicEndpoint = $value } }
        "API_PORT" { if (-not $apiPort) { $apiPort = $value } }
        "CLOUDFLARE_TUNNEL_TOKEN" { if (-not $tunnelToken) { $tunnelToken = $value } }
      }
    }
  }
}
if (-not $domain) { $domain = "localhost" }
if (-not $deploymentMode) { $deploymentMode = if ($domain -eq "localhost") { "local" } else { "vps" } }
if ($deploymentMode -notin @("local", "vps", "cloudflare")) {
  throw "DEPLOYMENT_MODE debe ser local, vps o cloudflare. Vuelve a ejecutar docker-setup para elegir un modo."
}
if (-not $s3PublicEndpoint) { $s3PublicEndpoint = if ($deploymentMode -eq "local") { "http://localhost:9000" } else { "https://s3.$domain" } }
if (-not $apiPort) { $apiPort = "3000" }

$composeArgs = @("--progress", "plain", "-f", "docker-compose.yml")
if ($deploymentMode -eq "cloudflare") {
  if (-not $tunnelToken -or $tunnelToken -match '^(replace-with-|yourcloudflare)') {
    throw "Configura CLOUDFLARE_TUNNEL_TOKEN en .env antes de iniciar el modo Cloudflare."
  }
  $composeArgs += @("-f", "docker-compose.cloudflare.yml")
} elseif ($deploymentMode -eq "local") {
  $composeArgs += @("-f", "docker-compose.local.yml")
}

Write-Host "Validando la configuración de Caddy..."
& docker compose @composeArgs run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& docker compose @composeArgs build savecloud-api steam-seed-worker create-bucket
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& docker compose @composeArgs up -d --no-build --remove-orphans
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$legacyDynamoImage = & docker image ls --quiet amazon/dynamodb-local:latest
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
if ($legacyDynamoImage) {
  & docker image rm amazon/dynamodb-local:latest | Out-Null
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Get-ContainerInspectValue {
  param(
    [Parameter(Mandatory = $true)][string]$Format,
    [Parameter(Mandatory = $true)][string]$Container
  )

  $output = & docker inspect --format $Format $Container 2>$null
  if ($LASTEXITCODE -ne 0) {
    return ""
  }

  return ($output | Out-String).Trim()
}

$deadline = (Get-Date).AddMinutes(2)
$ready = $false

while ((Get-Date) -lt $deadline) {
  $apiHealth = Get-ContainerInspectValue -Format '{{.State.Health.Status}}' -Container "savecloud-api"
  $bootstrapState = Get-ContainerInspectValue -Format '{{.State.Status}}' -Container "savecloud-storage-bootstrap"
  $bootstrapExitCode = Get-ContainerInspectValue -Format '{{.State.ExitCode}}' -Container "savecloud-storage-bootstrap"
  $workerState = Get-ContainerInspectValue -Format '{{.State.Status}}' -Container "savecloud-steam-seed-worker"
  $s3WorkerState = Get-ContainerInspectValue -Format '{{.State.Status}}' -Container "savecloud-s3-events-worker"
  $tunnelReady = $deploymentMode -ne "cloudflare" -or (Get-ContainerInspectValue -Format '{{.State.Status}}' -Container "savecloud-cloudflared") -eq "running"

  if ($apiHealth -eq "healthy" -and $bootstrapState -eq "exited" -and $bootstrapExitCode -eq "0" -and $workerState -eq "running" -and $s3WorkerState -eq "running" -and $tunnelReady) {
    $ready = $true
    break
  }

  if ($apiHealth -eq "unhealthy") {
    break
  }

  Start-Sleep -Seconds 2
}

if (-not $ready) {
  Write-Host "SaveCloud no quedó listo. Estado actual de los servicios:" -ForegroundColor Red
  & docker compose @composeArgs ps
  & docker compose @composeArgs logs --tail=80 caddy savecloud-api minio create-bucket steam-seed-worker s3-events-worker
  if ($deploymentMode -eq "cloudflare") { & docker compose @composeArgs logs --tail=80 cloudflared }
  exit 1
}

Write-Host ""
if ($domain -eq "localhost") {
  Write-Host "SaveCloud está listo. Endpoints locales:"
  Write-Host "  API HTTP:             http://localhost:$apiPort"
  Write-Host "  Salud de la API:      http://localhost:$apiPort/health"
  Write-Host "  WebSocket:            ws://localhost:$apiPort/ws"
  Write-Host "  S3 público/presigned: $s3PublicEndpoint"
  Write-Host "  Consola AIStor:       http://localhost:9001"
} elseif ($deploymentMode -eq "cloudflare") {
  Write-Host "SaveCloud está listo mediante Cloudflare Tunnel. URLs públicas:"
  Write-Host "  API HTTPS:            https://$domain"
  Write-Host "  Salud de la API:      https://$domain/health"
  Write-Host "  WebSocket seguro:     wss://$domain/ws"
  Write-Host "  S3 público/presigned: $s3PublicEndpoint"
  Write-Host "No hay puertos publicados en el host para Caddy, API o MinIO."
} else {
  Write-Host "SaveCloud está listo. URLs públicas:"
  Write-Host "  API HTTPS:            https://$domain"
  Write-Host "  Salud de la API:      https://$domain/health"
  Write-Host "  WebSocket seguro:     wss://$domain/ws"
  Write-Host "  S3 público/presigned: $s3PublicEndpoint"
  Write-Host ""
  Write-Host "Endpoints disponibles solo desde el VPS:"
  Write-Host "  API local:            http://127.0.0.1:$apiPort"
  Write-Host "  Consola AIStor:       http://127.0.0.1:9001"
}
Write-Host ""
Write-Host "Endpoints internos Docker:"
Write-Host "  API:                  savecloud-api:3000"
Write-Host "  S3:                   minio:9000"
