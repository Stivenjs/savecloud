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
  & docker compose logs --tail=80 savecloud-api minio create-bucket steam-seed-worker
  exit 1
}

Write-Host ""
Write-Host "SaveCloud está listo. URLs locales:"
Write-Host "  API HTTP:             http://localhost:3000"
Write-Host "  Salud de la API:      http://localhost:3000/health"
Write-Host "  WebSocket local:      ws://localhost:3000/ws"
Write-Host "  API S3 (AIStor):      http://localhost:9000"
Write-Host "  Consola AIStor:       http://localhost:9001"
Write-Host "  DynamoDB Local:       http://localhost:8000"
Write-Host ""
Write-Host "Para acceder desde otro equipo, sustituye localhost por la IP de este servidor."
Write-Host "El WebSocket local usa ws://; usa wss:// cuando publiques la API detrás de TLS."
