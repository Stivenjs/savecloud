#!/usr/bin/env sh
set -eu

docker compose up -d --build

deadline=$(( $(date +%s) + 120 ))
ready=false

inspect_value() {
  docker inspect --format "$1" "$2" 2>/dev/null || true
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  api_health=$(inspect_value '{{.State.Health.Status}}' savecloud-api)
  bootstrap_state=$(inspect_value '{{.State.Status}}' savecloud-storage-bootstrap)
  bootstrap_exit_code=$(inspect_value '{{.State.ExitCode}}' savecloud-storage-bootstrap)
  worker_state=$(inspect_value '{{.State.Status}}' savecloud-steam-seed-worker)

  if [ "$api_health" = "healthy" ] && [ "$bootstrap_state" = "exited" ] && [ "$bootstrap_exit_code" = "0" ] && [ "$worker_state" = "running" ]; then
    ready=true
    break
  fi

  if [ "$api_health" = "unhealthy" ]; then
    break
  fi

  sleep 2
done

if [ "$ready" != true ]; then
  echo "SaveCloud no quedó listo. Estado actual de los servicios:" >&2
  docker compose ps >&2
  docker compose logs --tail=80 savecloud-api minio create-bucket steam-seed-worker >&2
  exit 1
fi

cat <<'EOF'

SaveCloud está listo. URLs locales:
  API HTTP:             http://localhost:3000
  Salud de la API:      http://localhost:3000/health
  WebSocket local:      ws://localhost:3000/ws
  API S3 (AIStor):      http://localhost:9000
  Consola AIStor:       http://localhost:9001
  DynamoDB Local:       http://localhost:8000

Para acceder desde otro equipo, sustituye localhost por la IP de este servidor.
El WebSocket local usa ws://; usa wss:// cuando publiques la API detrás de TLS.
EOF
