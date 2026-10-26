# SaveCloud Crawler & Extractor Engine

Motor modular en Python para obtención sigilosa de contenido web (WAF/Cloudflare bypass) y extracción de enlaces directos de descarga para hosters en SaveCloud.

## Características

- **Diseño Modular y Clean Code**: Desacoplado en módulos dedicados (`core`, `extractors`, `strategies`, `utils`).
- **Arquitectura de Plugins para Hosters**: Añadir o modificar el extractor de un hoster solo requiere una clase que hereda de `BaseExtractor`.
- **Estrategia en 2 Niveles**:
  1. _Nivel 1 (FastFetch)_: Petición directa ultrarrápida (~100-200ms) mediante `curl_cffi` con suplantación de TLS (TLS impersonation).
  2. _Nivel 2 (StealthBrowser)_: Navegador headless indetectable con `Scrapling` y `Patchright`, soporte para resolución de Cloudflare Turnstile, detección de descargas y bloqueo de anuncios.
- **Selectores adaptativos**: Scrapling aprende selectores CSS de acciones de descarga y puede reubicarlos si cambia el DOM del hoster. La base SQLite persiste en los datos de usuario de SaveCloud (`%APPDATA%\SaveCloud\data\db\crawler_adaptive.db` en Windows).
- **Sesiones persistentes**: Las cookies del crawler se guardan en `%APPDATA%\SaveCloud\data\cache\crawler_sessions.json`; el archivo anterior en la raíz se migra al acceder a él.
- **Auto-instalación**: Descarga automática de navegadores Patchright/Playwright si no están presentes.
- **Watchdog Integrado**: Previene bloqueos indefinidos o procesos zombis en Windows y Unix.

## Estructura

```
crawler/
├── config.py             # Configuración, timeouts, selectores y scripts JS
├── engine.py             # Orquestador del crawler
├── cli.py                # Interfaz CLI y manejo de stdout
├── core/
│   ├── process.py        # Watchdog y gestión de subprocesos
│   ├── browser.py        # Detección e instalación de navegadores
│   ├── network.py        # Bloqueo de anuncios y filtros de ruta
│   └── firewall.py       # Detección de WAF y resolución de Turnstile
├── extractors/
│   ├── base.py           # BaseExtractor y ExtractionContext
│   ├── registry.py       # Registro y resolución por prioridad de URL
│   ├── generic.py        # Fallback genérico para botones y descargas
│   ├── vikingfile.py     # Extractor dedicado VikingFile
│   ├── filekeeper.py     # Extractor dedicado FileKeeper
│   ├── rootz.py          # Extractor dedicado Rootz
│   ├── buzzheavier.py    # Extractor dedicado Buzzheavier
│   └── onefichier.py     # Extractor dedicado 1fichier
├── strategies/
│   ├── base.py           # FetchStrategy base
│   ├── fast_fetch.py     # Estrategia TLS impersonation
│   └── stealth_browser.py# Estrategia navegador headless
└── utils/
    ├── adaptive.py       # Aprendizaje y recuperación de selectores con Scrapling
    ├── dom.py            # Helpers de interacción DOM con fallback adaptativo
    ├── json_cleaner.py   # Sanitización de JSON
    └── page_utils.py     # Extracción de contenido DOM
```

Adaptive se entrena cuando los selectores CSS configurados encuentran su elemento y solo intenta relocalizarlo si el selector original ya no encuentra coincidencias. Los selectores exclusivos de Playwright, como `:has-text()`, siguen usando el flujo de Playwright sin entrar al parser CSS de Scrapling. Si no hay datos guardados o no se encuentra una coincidencia suficientemente similar, continúa el flujo actual del extractor.

## Cómo añadir un nuevo Hoster Extractor

Crea un archivo en `crawler/extractors/<mi_hoster>.py`:

```python
from crawler.extractors.base import BaseExtractor, ExtractionContext

class MiHosterExtractor(BaseExtractor):
    name = "mi_hoster"
    priority = 80  # Prioridad mayor a la del GenericExtractor (10)

    def matches(self, url: str) -> bool:
        return "mihoster.com" in url.lower()

    def on_response(self, response, context: ExtractionContext) -> None:
        # Intercepta APIs XHR si es necesario
        if "api/download" in getattr(response, "url", ""):
            # procesa y asigna:
            context.captured_download_url = ...

    def page_action(self, page, context: ExtractionContext) -> str | None:
        # Interacción específica con el DOM (clicks, esperas, etc.)
        btn = page.locator("#download-now")
        if btn.count() > 0:
            btn.click()
        return None
```

Y expórtalo en `crawler/extractors/__init__.py`. ¡El registro lo reconocerá automáticamente!

## Ejecución y Pruebas

```bash
# Ejecutar pruebas unitarias
python -m unittest discover -s tests -p "test_*.py"

# Ejecutar crawler directamente
python -m crawler https://ejemplo.com/archivo
```
