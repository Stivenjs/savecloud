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
  docker compose logs --tail=80 caddy savecloud-api minio create-bucket steam-seed-worker >&2
  exit 1
fi

domain=${DOMAIN:-}
s3_public_endpoint=${S3_PUBLIC_ENDPOINT:-}
api_port=${API_PORT:-}
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    value=$(printf '%s' "$value" | tr -d '\r')
    case "$key" in
      DOMAIN) [ -n "$domain" ] || domain=$value ;;
      S3_PUBLIC_ENDPOINT) [ -n "$s3_public_endpoint" ] || s3_public_endpoint=$value ;;
      API_PORT) [ -n "$api_port" ] || api_port=$value ;;
    esac
  done < .env
fi
domain=${domain:-localhost}
s3_public_endpoint=${s3_public_endpoint:-http://localhost:9000}
api_port=${api_port:-3000}

if [ "$domain" = "localhost" ]; then
  cat <<EOF
SaveCloud está listo. Endpoints locales:
  API HTTP:             http://localhost:${api_port}
  Salud de la API:      http://localhost:${api_port}/health
  WebSocket:            ws://localhost:${api_port}/ws
  S3 público/presigned: ${s3_public_endpoint}
  Consola AIStor:       http://localhost:9001
  DynamoDB Local:       http://localhost:8000

Endpoints internos Docker:
  API:                  savecloud-api:3000
  S3:                   minio:9000
  DynamoDB:             dynamodb-local:8000
EOF
else
  cat <<EOF
SaveCloud está listo. URLs públicas:
  API HTTPS:            https://${domain}
  Salud de la API:      https://${domain}/health
  WebSocket seguro:     wss://${domain}/ws
  S3 público/presigned: ${s3_public_endpoint}

Endpoints disponibles solo desde el VPS:
  API local:            http://127.0.0.1:${api_port}
  Consola AIStor:       http://127.0.0.1:9001
  DynamoDB Local:       http://127.0.0.1:8000

Endpoints internos Docker:
  API:                  savecloud-api:3000
  S3:                   minio:9000
  DynamoDB:             dynamodb-local:8000
EOF
fi
