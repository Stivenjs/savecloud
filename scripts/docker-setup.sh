#!/usr/bin/env sh
set -eu

env_file=.env
example_file=.env.docker.example

if [ ! -f "$env_file" ]; then
  if [ ! -f "$example_file" ]; then
    echo "No se encontró .env.docker.example en la raíz del repositorio." >&2
    exit 1
  fi
  cp "$example_file" "$env_file"
  chmod 600 "$env_file"
  echo "Se creó .env desde .env.docker.example."
fi

read_env() {
  key=$1
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value ~ /^".*"$/ || value ~ /^\047.*\047$/) value = substr(value, 2, length(value) - 2)
      result = value
    }
    END { print result }
  ' "$env_file"
}

set_env() {
  key=$1
  value=$2
  temp_file="${env_file}.setup-tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "=" }
    substr($0, 1, length(prefix)) == prefix { print prefix value; found = 1; next }
    { print }
    END { if (!found) print prefix value }
  ' "$env_file" > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$env_file"
}

new_hex_secret() {
  byte_count=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$byte_count"
  else
    od -An -N "$byte_count" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

read_domain() {
  while :; do
    printf 'Dominio para SaveCloud (ej. savecloud.example.com): ' >&2
    IFS= read -r value
    value=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')
    case "$value" in
      *[!a-z0-9.-]*|.*|*.) valid=false ;;
      *.*) valid=true ;;
      *) valid=false ;;
    esac
    if [ "$valid" = true ] && [ "${#value}" -le 253 ] && ! printf '%s' "$value" | grep -Eq '(^|\.)-|-(\.|$)|\.\.|\.[0-9]+$'; then
      printf '%s\n' "$value"
      return
    fi
    echo "Escribe un dominio sin https://, ruta ni puerto." >&2
  done
}

read_public_ipv4() {
  while :; do
    printf 'IP pública IPv4 del VPS (la encuentras en el panel de tu proveedor): ' >&2
    IFS= read -r value
    if printf '%s\n' "$value" | awk -F. 'NF == 4 { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1; exit 0 } END { if (NF != 4) exit 1 }'; then
      printf '%s\n' "$value"
      return
    fi
    echo "Escribe una dirección IPv4, por ejemplo 203.0.113.25." >&2
  done
}

echo
echo "Asistente de instalación Docker de SaveCloud"
echo "  1. Desarrollo local (localhost)"
echo "  2. VPS con dominio propio y HTTPS automático mediante Caddy"
printf 'Elige 1 o 2: '
IFS= read -r choice
while [ "$choice" != 1 ] && [ "$choice" != 2 ]; do
  printf 'Opción inválida. Elige 1 o 2: '
  IFS= read -r choice
done

if [ "$choice" = 1 ]; then
  domain=localhost
  s3_endpoint=http://localhost:9000
  echo "Modo local: la API y S3 estarán disponibles solo en esta computadora."
else
  domain=$(read_domain)
  public_ipv4=$(read_public_ipv4)
  s3_endpoint="https://s3.$domain"
  echo
  echo "Antes del HTTPS automático, configura estos DNS en el panel de tu dominio:"
  echo "  Registro A   Host @    Apunta a: $public_ipv4"
  echo "  Registro A   Host s3   Apunta a: $public_ipv4"
  echo "No añadas https://, puerto ni ruta en los registros DNS."
  echo "Abre TCP 80 y 443 en el firewall del VPS y del proveedor. UDP 443 es opcional."
  printf '¿Ya configuraste esos DNS y puertos? (s/N): '
  IFS= read -r dns_ready
  case "$dns_ready" in
    s|S|si|SI|sí|Sí|y|Y|yes|YES) ;;
    *) echo "Puedes continuar, pero Caddy no obtendrá certificados hasta que DNS y firewall estén listos." ;;
  esac
fi

api_port=$(read_env API_PORT)
api_port=${api_port:-3000}
set_env DOMAIN "$domain"
set_env S3_PUBLIC_ENDPOINT "$s3_endpoint"
set_env API_PORT "$api_port"

api_key=$(read_env SYNC_GAMES_API_KEY)
case "$api_key" in
  ""|replace-with-*|sg_secret_key_12345) api_key="sc_$(new_hex_secret 32)"; set_env SYNC_GAMES_API_KEY "$api_key" ;;
esac

object_user=$(read_env OBJECT_STORAGE_ACCESS_KEY)
case "$object_user" in
  ""|replace-with-*|minioadmin) object_user="savecloud_$(new_hex_secret 8)"; set_env OBJECT_STORAGE_ACCESS_KEY "$object_user" ;;
esac

object_secret=$(read_env OBJECT_STORAGE_SECRET_KEY)
case "$object_secret" in
  ""|replace-with-*|minioadmin) object_secret=$(new_hex_secret 32); set_env OBJECT_STORAGE_SECRET_KEY "$object_secret" ;;
esac

license_path=$(read_env MINIO_LICENSE_PATH)
license_path=${license_path:-./minio.license}
while :; do
  case "$license_path" in
    /*) resolved_license_path=$license_path ;;
    *) resolved_license_path="$(pwd)/$license_path" ;;
  esac
  if [ -f "$resolved_license_path" ]; then break; fi
  echo "MinIO AIStor necesita su archivo de licencia minio.license."
  printf 'Escribe la ruta al archivo de licencia (Enter para ./minio.license): '
  IFS= read -r license_path
  license_path=${license_path:-./minio.license}
done
set_env MINIO_LICENSE_PATH "$resolved_license_path"

export DOMAIN="$domain"
export S3_PUBLIC_ENDPOINT="$s3_endpoint"
export API_PORT="$api_port"
export SYNC_GAMES_API_KEY="$api_key"
export OBJECT_STORAGE_ACCESS_KEY="$object_user"
export OBJECT_STORAGE_SECRET_KEY="$object_secret"
export MINIO_LICENSE_PATH="$resolved_license_path"

echo
echo "Configuración guardada en .env. La clave de API para la aplicación SaveCloud es:"
echo "$api_key"
echo "Guárdala en Configuración → Conexión de servidor. No la compartas."
if [ "$choice" = 2 ]; then
  echo
  echo "Dominio API: https://$domain"
  echo "Dominio S3:  $s3_endpoint"
fi
echo

exec sh scripts/docker-up.sh
