# Configuración de actualizaciones automáticas

La app incluye el sistema de actualizaciones de Tauri. Para publicar actualizaciones a tus usuarios.

---

## Pasos para que funcione (resumen)

1. **Compilar** con firma → genera el instalador `.exe` y el `.sig`
2. **Crear release** en GitHub (ej. `v0.1.7`)
3. **Subir** el `.exe` y el `.sig` como assets del release
4. **Crear y subir** `latest.json` que apunte a esos archivos (ver Paso C)
5. La app comprobará automáticamente en ese endpoint

## 1. Generar claves de firma

Si tienes `CI=1` en el entorno (Cursor, GitHub Actions, etc.), desactívalo primero. El CLI espera `CI=true` o `CI=false`, no `1`.

**PowerShell:**

```powershell
$env:CI = $null  # o $env:CI = "false"
mkdir -Force $env:USERPROFILE\.tauri
cd apps/savecloud-desktop
bun run tauri signer generate -w $env:USERPROFILE\.tauri\savecloud.key
```

**Git Bash / MINGW64:**

```bash
unset CI
mkdir -p ~/.tauri
cd apps/savecloud-desktop
bun run tauri signer generate -w $HOME/.tauri/savecloud.key
```

**Alternativa con `npx` (evita problemas con bun y el `--`):**

```bash
cd apps/savecloud-desktop
npx tauri signer generate -w "$HOME/.tauri/savecloud.key"
```

**Importante:** Guarda la clave privada (`savecloud.key`) en un lugar seguro. Sin ella no podrás publicar actualizaciones futuras.

## 2. Configurar tauri.conf.json

Edita `src-tauri/tauri.conf.json` y reemplaza:

- **pubkey**: El contenido completo del archivo `savecloud.key.pub` (todo en una línea)
- **endpoints**: La URL de tu JSON de actualización. Opciones comunes:
  - **GitHub Releases**: `https://github.com/USUARIO/REPO/releases/latest/download/latest.json`
  - **CrabNebula Cloud**: Obtén la URL desde [crabnebula.cloud](https://crabnebula.cloud/)

## 3. Compilar con firma

### En local (PowerShell)

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\savecloud.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "tu_contraseña"
bun run tauri build
```

### En GitHub Actions (automático)

La workflow ya está configurada. Solo necesitas añadir estos **secrets** al repositorio:

1. Ve a **GitHub → Tu repo → Settings → Secrets and variables → Actions**
2. Crea estos secrets:
   - **`TAURI_SIGNING_PRIVATE_KEY`**: contenido completo del archivo `savecloud.key` (cópialo y pégalo)
   - **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: la contraseña que usaste al generar la clave

Cuando hagas push de un tag (ej. `v0.1.7`), la action compilará, firmará, generará `latest.json` y publicará todo en el release automáticamente.

### Notas del update

Las notas que ve el usuario en el diálogo de actualización se leen del archivo **`RELEASE_NOTES.md`** en la raíz del repo. Antes de crear el tag:

1. Edita `RELEASE_NOTES.md` con las novedades de la versión (lista, párrafos, lo que quieras)
2. Haz commit y push
3. Crea el tag

## 4. Formato del JSON de actualización (GitHub Releases)

Crea un archivo `latest.json` y súbelo como asset en cada release. Ejemplo:

```json
{
  "version": "0.1.8",
  "notes": "Correcciones y mejoras",
  "pub_date": "2025-03-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENIDO_DEL_ARCHIVO_.sig",
      "url": "https://github.com/USUARIO/REPO/releases/download/v0.1.8/SaveCloud_0.1.8_x64-setup.exe"
    }
  }
}
```

El contenido de `signature` es el archivo `.sig` que Tauri genera junto al instalador al hacer build con `createUpdaterArtifacts: true`.

## 5. Tu primer release (paso a paso)

### Paso A: Compilar con firma

```powershell
cd apps/savecloud-desktop
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\savecloud.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "tu_contraseña"
bun run tauri build
```

Al terminar, tendrás en `src-tauri/target/release/bundle/nsis/`:

- `SaveCloud_0.1.7_x64-setup.exe`
- `SaveCloud_0.1.7_x64-setup.exe.sig`

### Paso B: Crear el release en GitHub

1. Ve a https://github.com/Stivenjs/savecloud/releases
2. Click en **"Create a new release"**
3. Tag: `v0.1.7` (o el número de versión que tengas en tauri.conf.json)
4. Título: `v0.1.7`
5. Sube como **assets**:
   - `SaveCloud_0.1.7_x64-setup.exe`
   - `SaveCloud_0.1.7_x64-setup.exe.sig`
6. Publica el release

### Paso C: Crear latest.json

Crea un archivo `latest.json` con este contenido (ajusta versión y fechas):

```json
{
  "version": "0.1.7",
  "notes": "Primera versión con actualizaciones automáticas",
  "pub_date": "2025-03-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "AQUÍ_VA_EL_CONTENIDO_COMPLETO_DEL_ARCHIVO_.sig",
      "url": "https://github.com/Stivenjs/savecloud/releases/download/v0.1.7/SaveCloud_0.1.7_x64-setup.exe"
    }
  }
}
```

**Importante:** En `signature` pega TODO el contenido del archivo `SaveCloud_0.1.7_x64-setup.exe.sig` (es una línea larga de caracteres).

**Atajo:** Hay un script que genera el `latest.json` automáticamente:

```bash
bun run scripts/generate-latest-json.ts
```

Crea `latest.json` en la raíz del proyecto listo para subir.

### Paso D: Subir latest.json al release

1. En el mismo release que creaste, click **"Edit release"**
2. Arrastra o sube el archivo `latest.json` como asset
3. Guarda

La URL `https://github.com/Stivenjs/savecloud/releases/latest/download/latest.json` apuntará al `latest.json` del último release.

### Paso E: Probar

1. Instala la versión actual de la app (la que compilaste)
2. En Configuración → "Buscar actualizaciones": debería decir "Ya tienes la última versión" (porque 0.1.7 = 0.1.7)
3. Para probar el flujo: cambia la versión en `tauri.conf.json` a `0.1.6`, compila, instala esa versión antigua. Luego "Buscar actualizaciones" debería detectar la 0.1.7.

---

## Resumen: Archivos en cada release

En cada release futuro, sube:

- El instalador (`.exe`, `.msi`, `.app.tar.gz`, etc.)
- El archivo `.sig` correspondiente
- El `latest.json` con las URLs y firmas actualizadas para esa versión
