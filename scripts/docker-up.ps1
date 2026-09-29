$ErrorActionPreference = "Stop"

& docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
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

  if ($apiHealth -eq "healthy" -and $bootstrapState -eq "exited" -and $bootstrapExitCode -eq "0" -and $workerState -eq "running") {
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
  & docker compose ps
  & docker compose logs --tail=80 caddy savecloud-api minio create-bucket steam-seed-worker
  exit 1
}

$domain = $env:DOMAIN
$s3PublicEndpoint = $env:S3_PUBLIC_ENDPOINT
$apiPort = $env:API_PORT
if (Test-Path -LiteralPath ".env") {
  foreach ($line in Get-Content -LiteralPath ".env") {
    if ($line -match '^\s*(DOMAIN|S3_PUBLIC_ENDPOINT|API_PORT)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2].Trim('"', "'")
      switch ($key) {
        "DOMAIN" { if (-not $domain) { $domain = $value } }
        "S3_PUBLIC_ENDPOINT" { if (-not $s3PublicEndpoint) { $s3PublicEndpoint = $value } }
        "API_PORT" { if (-not $apiPort) { $apiPort = $value } }
      }
    }
  }
}
if (-not $domain) { $domain = "localhost" }
if (-not $s3PublicEndpoint) { $s3PublicEndpoint = "http://localhost:9000" }
if (-not $apiPort) { $apiPort = "3000" }

Write-Host ""
if ($domain -eq "localhost") {
  Write-Host "SaveCloud está listo. Endpoints locales:"
  Write-Host "  API HTTP:             http://localhost:$apiPort"
  Write-Host "  Salud de la API:      http://localhost:$apiPort/health"
  Write-Host "  WebSocket:            ws://localhost:$apiPort/ws"
  Write-Host "  S3 público/presigned: $s3PublicEndpoint"
  Write-Host "  Consola AIStor:       http://localhost:9001"
  Write-Host "  DynamoDB Local:       http://localhost:8000"
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
  Write-Host "  DynamoDB Local:       http://127.0.0.1:8000"
}
Write-Host ""
Write-Host "Endpoints internos Docker:"
Write-Host "  API:                  savecloud-api:3000"
Write-Host "  S3:                   minio:9000"
Write-Host "  DynamoDB:             dynamodb-local:8000"
