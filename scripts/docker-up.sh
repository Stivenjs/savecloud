#!/usr/bin/env sh
set -eu

deployment_mode=${DEPLOYMENT_MODE:-}
domain=${DOMAIN:-}
s3_public_endpoint=${S3_PUBLIC_ENDPOINT:-}
api_port=${API_PORT:-}
tunnel_token=${CLOUDFLARE_TUNNEL_TOKEN:-}
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    value=$(printf '%s' "$value" | tr -d '\r')
    case "$key" in
      DEPLOYMENT_MODE) [ -n "$deployment_mode" ] || deployment_mode=$value ;;
      DOMAIN) [ -n "$domain" ] || domain=$value ;;
      S3_PUBLIC_ENDPOINT) [ -n "$s3_public_endpoint" ] || s3_public_endpoint=$value ;;
      API_PORT) [ -n "$api_port" ] || api_port=$value ;;
      CLOUDFLARE_TUNNEL_TOKEN) [ -n "$tunnel_token" ] || tunnel_token=$value ;;
    esac
  done < .env
fi
domain=${domain:-localhost}
if [ -z "$deployment_mode" ]; then
  if [ "$domain" = localhost ]; then deployment_mode=local; else deployment_mode=vps; fi
fi
case "$deployment_mode" in
  local|vps|cloudflare) ;;
  *) echo "DEPLOYMENT_MODE debe ser local, vps o cloudflare. Vuelve a ejecutar docker-setup para elegir un modo." >&2; exit 1 ;;
esac
if [ -z "$s3_public_endpoint" ]; then
  if [ "$deployment_mode" = local ]; then s3_public_endpoint=http://localhost:9000; else s3_public_endpoint="https://s3.$domain"; fi
fi
api_port=${api_port:-3000}

set -- --progress plain -f docker-compose.yml
if [ "$deployment_mode" = cloudflare ]; then
  case "$tunnel_token" in
    ""|replace-with-*|YourCloudflareTunnelTokenHere) echo "Configura CLOUDFLARE_TUNNEL_TOKEN en .env antes de iniciar el modo Cloudflare." >&2; exit 1 ;;
  esac
  set -- "$@" -f docker-compose.cloudflare.yml
elif [ "$deployment_mode" = local ]; then
  set -- "$@" -f docker-compose.local.yml
fi

if docker inspect --format '{{range $name, $config := .NetworkSettings.Networks}}{{println $name}}{{end}}' savecloud-minio 2>/dev/null | awk '/_proxy_upstreams$/ { found = 1 } END { exit !found }'; then
  echo "Se detectó la topología anterior de Docker. Para separar las redes hay que recrear los contenedores." >&2
  echo "La interrupción dura mientras reinicia SaveCloud. Los datos de los volúmenes se conservan; no se borran." >&2
  if [ ! -t 0 ]; then
    echo "Ejecuta este asistente en una terminal interactiva para confirmar la migración." >&2
    exit 1
  fi
  printf '¿Continuar con la migración de red? (s/N): '
  IFS= read -r confirm_network_migration
  case "$confirm_network_migration" in
    s|S|si|SI|sí|Sí|y|Y|yes|YES) ;;
    *) echo "No se aplicaron cambios. Vuelve a ejecutar este comando cuando puedas reiniciar SaveCloud." >&2; exit 1 ;;
  esac
  docker compose "$@" down --remove-orphans
fi

echo "Validando la configuración de Caddy..."
caddy_running=$(docker inspect --format '{{.State.Running}}' savecloud-caddy 2>/dev/null || true)
if [ "$caddy_running" = true ]; then
  # Reutiliza el contenedor activo para evitar duplicar sus IP fijas en las redes Docker.
  docker exec savecloud-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
else
  docker compose "$@" run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
fi
docker compose "$@" up -d --build --remove-orphans
legacy_dynamo_image=$(docker image ls --quiet amazon/dynamodb-local:latest)
if [ -n "$legacy_dynamo_image" ]; then
  docker image rm amazon/dynamodb-local:latest >/dev/null
fi

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
  s3_worker_state=$(inspect_value '{{.State.Status}}' savecloud-s3-events-worker)
  tunnel_ready=true
  if [ "$deployment_mode" = cloudflare ]; then
    tunnel_state=$(inspect_value '{{.State.Status}}' savecloud-cloudflared)
    [ "$tunnel_state" = running ] || tunnel_ready=false
  fi

  if [ "$api_health" = "healthy" ] && [ "$bootstrap_state" = "exited" ] && [ "$bootstrap_exit_code" = "0" ] && [ "$worker_state" = "running" ] && [ "$s3_worker_state" = "running" ] && [ "$tunnel_ready" = true ]; then
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
  docker compose "$@" ps >&2
  docker compose "$@" logs --tail=80 caddy savecloud-api minio create-bucket steam-seed-worker s3-events-worker >&2
  if [ "$deployment_mode" = cloudflare ]; then docker compose "$@" logs --tail=80 cloudflared >&2; fi
  exit 1
fi

if [ "$domain" = "localhost" ]; then
  cat <<EOF
SaveCloud está listo. Endpoints locales:
  API HTTP:             http://localhost:${api_port}
  Salud de la API:      http://localhost:${api_port}/health
  WebSocket:            ws://localhost:${api_port}/ws
  S3 público/presigned: ${s3_public_endpoint}
  Consola AIStor:       http://localhost:9001

Endpoints internos Docker:
  API:                  savecloud-api:3000
  S3:                   minio:9000
EOF
elif [ "$deployment_mode" = cloudflare ]; then
  cat <<EOF
SaveCloud está listo mediante Cloudflare Tunnel. URLs públicas:
  API HTTPS:            https://${domain}
  Salud de la API:      https://${domain}/health
  WebSocket seguro:     wss://${domain}/ws
  S3 público/presigned: ${s3_public_endpoint}
Consola MinIO local:    http://127.0.0.1:9001
Caddy, API y S3 no publican puertos en el host.
S3 es para la app, no una página web; abrir su raíz en el navegador puede mostrar AccessDenied.

Endpoints internos Docker:
  API:                  savecloud-api:3000
  S3:                   minio:9000
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

Endpoints internos Docker:
  API:                  savecloud-api:3000
  S3:                   minio:9000
EOF
fi
