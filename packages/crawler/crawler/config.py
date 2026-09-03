"""Global configuration, constants, and defaults for SaveCloud Crawler."""

import os
import sys

CREATE_NO_WINDOW: int = 0x08000000 if os.name == "nt" else 0
PROCESS_TIMEOUT_SECONDS: int = 120
FAST_FETCH_TIMEOUT_SECONDS: int = 12
BROWSER_TIMEOUT_MS: int = 45000
DOM_WAIT_TIMEOUT_MS: int = 4000
SELECTOR_WAIT_TIMEOUT_MS: int = 3500

DEFAULT_REFERER: str = "https://www.google.com/"
DEFAULT_USER_AGENT: str = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS: dict[str, str] = {
    "Referer": DEFAULT_REFERER,
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

IGNORED_EXTENSIONS: set[str] = {
    ".webmanifest", ".js", ".css", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2",
    ".ttf", ".otf", ".html", ".htm", ".txt", ".json", ".map",
}

AD_KEYWORDS: tuple[str, ...] = (
    "opera.com", "adcash", "popunder", "clickunder", "acscdn",
    "adsterra", "doubleclick", "adsystem", "onclick", "traffic",
    "adnxs", "adform", "optimizely", "outbrain", "taboola",
    "revcontent", "mgid", "criteo", "google-analytics", "googletagmanager",
    "googlesyndication", "adservice", "adserver", "adskeeper", "popads",
    "propellerads", "exoclick", "a-ads", "amazon-adsystem", "pubmatic",
    "rubiconproject", "smartadserver", "openx", "bidswitch", "casalemedia",
)

FIREWALL_KEYWORDS: tuple[str, ...] = (
    "cf-turnstile",
    "cf_chl",
    "cf-browser-verification",
    "ray id",
    "just a moment...",
    "just a moment",
    "attention required",
    "awswaf",
    "token.awswaf.com",
    "awswafcookiedomainlist",
    "gokuprops",
)

GENERIC_DIRECT_LINK_SELECTORS: tuple[str, ...] = (
    "a#download-link",
    "a[href*='/download/']",
    "a[href*='?download']",
    "a.download-btn",
)

GENERIC_BUTTON_SELECTORS: tuple[str, ...] = (
    "#download-button",
    "#download-btn",
    "a#download-link",
    "button#download-button",
    ".download-button",
    "a.download-btn",
    "button.download-btn",
    "a[hx-get*='download']",
    "a[hx-post*='download']",
    "[hx-get*='download']",
    "[hx-post*='download']",
    "a:has-text('Download')",
    "a:has-text('Descargar')",
    "button:has-text('Download')",
    "button:has-text('Descargar')",
    "a[href*='/download/']",
    "a[href*='?download']",
    "a[href*='download']",
    "a[href*='/dl/']",
)

COMBINED_VISIBLE_SELECTORS: str = (
    "a#download-link, #download-button, #download-btn, .download-button, "
    "a.download-btn, button#download-button, a[hx-get*='download'], [hx-get*='download']"
)

# Cloudflare Turnstile automation constants
TURNSTILE_FRAME_SUBSTRING: str = "challenges.cloudflare.com"
TURNSTILE_RESPONSE_INPUT: str = "input[name='cf-turnstile-response']"
TURNSTILE_CHECKBOX_OFFSET_X: float = 28.0
TURNSTILE_CHECKBOX_OFFSET_Y: float = 32.0
TURNSTILE_CHECKBOX_SELECTORS: tuple[str, ...] = (
    "input[type='checkbox']",
    "input",
    "#cf-stage input",
    "label.ctp-checkbox-label",
    ".ctp-checkbox-label",
    "#challenge-stage",
    "body",
)
TURNSTILE_OVERLAY_SELECTORS: tuple[str, ...] = (
    "#dontfoid",
    "div[id^='dontfo']",
)
TURNSTILE_READY_DOWNLOAD_SELECTORS: tuple[str, ...] = (
    "a#download-link",
    "#download-btn",
    ".download-button",
    "a.download-btn",
)

JS_STREAM_FETCH: str = """async (targetUrl) => {
    try {
        const r = await fetch(targetUrl, {
            credentials: 'include',
            headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        if (!r.ok) return null;
        const reader = r.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let result = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            result += decoder.decode(value, { stream: true });
        }
        result += decoder.decode();
        return result;
    } catch(e) { return null; }
}"""

# Banderas de optimización agresiva para el arranque ultrarrápido de Chromium
CHROMIUM_OPTIMIZATION_FLAGS: tuple[str, ...] = (
    "--blink-settings=imagesEnabled=false",
    "--mute-audio",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--disable-ipc-flooding-protection",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--metrics-recording-only",
)
