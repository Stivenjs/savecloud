#!/usr/bin/env python3

import atexit
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlparse

if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ:
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(home, "AppData", "Local", "ms-playwright")
    elif sys.platform == "darwin":
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(home, "Library", "Caches", "ms-playwright")
    else:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(home, ".cache", "ms-playwright")


CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


PROCESS_TIMEOUT_SECONDS = 120

def _start_watchdog(timeout: int = PROCESS_TIMEOUT_SECONDS):
    def _die():
        sys.stderr.write(f"[watchdog] Timeout after {timeout}s — killing process\n")
        _kill_chromium_children()
        os._exit(3)

    timer = threading.Timer(timeout, _die)
    timer.daemon = True
    timer.start()
    return timer


def _kill_chromium_children():
    pid = os.getpid()
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
                timeout=5,
            )
        else:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception:
        pass

@atexit.register
def _cleanup_on_exit():
    try:
        if sys.platform == "win32":
            pid = os.getpid()
            result = subprocess.run(
                ["wmic", "process", "where", f"ParentProcessId={pid}", "get", "ProcessId"],
                capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=5,
            )
            for line in result.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    try:
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", line],
                            capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=3,
                        )
                    except Exception:
                        pass
    except Exception:
        pass


def _extract_host(url: str) -> str:
    return urlparse(url).netloc.lower().split(":")[0]


def is_json_url(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".json")


def _smart_referer(url: str) -> str:
    host = _extract_host(url)
    return "https://www.google.com/"

def ensure_fetchers_installed():
    global StealthyFetcher
    try:
        from scrapling.fetchers import StealthyFetcher as SF
        StealthyFetcher = SF
        return True
    except ModuleNotFoundError as exc:
        missing = str(exc)
        if "curl_cffi" not in missing and "scrapling.fetchers" not in missing:
            raise

    if getattr(sys, 'frozen', False):
        raise RuntimeError(
            "Scrapling fetchers are not bundled in the compiled executable. "
            "Please ensure 'scrapling[fetchers]' is included in your PyInstaller build configuration."
        )

    cmd = [sys.executable, "-m", "pip", "install", "--user", "scrapling[fetchers]"]
    result = subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
    if result.returncode != 0:
        raise RuntimeError(
            "No se pudieron instalar los extras de Scrapling.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    
    from scrapling.fetchers import StealthyFetcher as SF
    StealthyFetcher = SF
    return True


def ensure_browsers_installed():
    try:
        from scrapling.cli import install
        install([], standalone_mode=False)
        return
    except Exception as exc:
        if getattr(sys, 'frozen', False):
            raise RuntimeError(
                f"No se pudieron instalar los navegadores de Scrapling programáticamente dentro de la aplicación empaquetada: {exc}"
            )
    last_error = None
    for cmd in [
        [sys.executable, "-m", "scrapling.cli", "install"],
        [sys.executable, "-m", "scrapling.cli", "install", "--force"],
    ]:
        result = subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
        if result.returncode == 0:
            return
        last_error = (
            "No se pudieron instalar los navegadores de Scrapling.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    raise RuntimeError(last_error or "No se pudieron instalar los navegadores de Scrapling.")


StealthyFetcher = None

JS_STREAM_FETCH = """async (targetUrl) => {
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


def clean_json_from_html(text: str) -> str:
    if not text:
        return ""
    text_stripped = text.strip()
    if text_stripped.startswith("{") or text_stripped.startswith("["):
        return text_stripped

    clean = re.sub(r'<[^>]+>', '', text_stripped)
    clean_stripped = clean.strip()
    if clean_stripped.startswith("{") or clean_stripped.startswith("["):
        return clean_stripped

    first_brace = text_stripped.find('{')
    last_brace = text_stripped.rfind('}')
    first_bracket = text_stripped.find('[')
    last_bracket = text_stripped.rfind(']')

    candidates = []
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(text_stripped[first_brace:last_brace+1])
    if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
        candidates.append(text_stripped[first_bracket:last_bracket+1])

    for cand in candidates:
        try:
            json.loads(cand)
            return cand
        except Exception:
            pass

    return text_stripped


def is_firewall_challenge(text: str, ignore_turnstile: bool = False) -> bool:
    if not text:
        return False
    lower = text.lower()
    if not ("<html" in lower or "<!doctype" in lower or "<head" in lower or "<body" in lower):
        return False
    
    has_turnstile = not ignore_turnstile and (
        "cf-turnstile" in lower
        or "cf_chl" in lower
        or "cf-browser-verification" in lower
        or ("cloudflare" in lower and "turnstile" in lower)
    )

    return (
        has_turnstile
        or ("cloudflare" in lower and "ray id" in lower)
        or "just a moment..." in lower
        or "just a moment" in lower
        or "attention required" in lower
        or "awswaf" in lower
        or "token.awswaf.com" in lower
        or "awswafcookiedomainlist" in lower
        or "gokuprops" in lower
    )


def get_valid_content(text: str, expect_json: bool, ignore_turnstile: bool = False) -> str | None:
    if not text or not text.strip():
        return None
    if is_firewall_challenge(text, ignore_turnstile):
        return None
    if expect_json:
        cleaned = clean_json_from_html(text)
        if cleaned.startswith("{") or cleaned.startswith("["):
            try:
                json.loads(cleaned)
                return cleaned
            except Exception:
                pass
        return None
    return text


def extract_body(page) -> str:
    try:
        if hasattr(page, "json"):
            val = page.json()
            if callable(val):
                val = val()
            if val:
                return json.dumps(val)
    except Exception:
        pass

    for attr in ("body", "html_content", "content", "text"):
        if not hasattr(page, attr):
            continue
        value = getattr(page, attr)
        if callable(value):
            try:
                value = value()
            except TypeError:
                pass
        if value is None:
            continue
        if isinstance(value, bytes):
            if not value:
                continue
            try:
                return value.decode("utf-8", "replace")
            except Exception:
                pass
        else:
            val_str = str(value)
            if not val_str:
                continue
            return val_str

    try:
        if hasattr(page, "get_all_text"):
            text = page.get_all_text()
            if text and text.strip():
                return text
    except Exception:
        pass

    return str(page)


def _strategy_browser_fetch(url: str, expect_json: bool) -> str | None:
    result_holder = {"text": None}

    def page_action(page):
        try:
            fetched = page.evaluate(JS_STREAM_FETCH, url)
            if isinstance(fetched, str) and fetched.strip():
                result_holder["text"] = fetched
        except Exception:
            pass

    def page_setup(page):
        _setup_generic_route(page, url)

    kwargs = {
        "headless": True,
        "network_idle": False,
        "solve_cloudflare": True,
        "timeout": 25000,
        "page_action": page_action,
        "google_search": False,
        "dns_over_https": True,
        "disable_ads": True,
    }

    kwargs["page_setup"] = page_setup

    StealthyFetcher.fetch(url, **kwargs)
    text = result_holder["text"]
    return get_valid_content(text, expect_json, ignore_turnstile=True)


def solve_embedded_turnstile(page) -> bool:
    try:
        target_selectors = ["a#download-link", "#download-btn", ".download-button", "a.download-btn"]
        for sel in target_selectors:
            try:
                if page.locator(sel).count() > 0 and page.locator(sel).first.is_visible():
                    return True
            except Exception:
                pass

        cf_frame = None
        for frame in page.frames:
            if "challenges.cloudflare.com" in frame.url:
                cf_frame = frame
                break
        
        if cf_frame:
            sys.stderr.write("Found embedded Cloudflare Turnstile iframe, attempting to solve...\n")
            try:
                page.evaluate("document.querySelectorAll('#dontfoid, div[id^=\"dontfo\"]').forEach(el => el.remove())")
            except Exception as e:
                sys.stderr.write(f"Failed to remove intercepting element: {e}\n")
            try:
                checkbox = cf_frame.locator(".tIReV4 input").first
                if checkbox.count() > 0 and checkbox.is_visible():
                    sys.stderr.write("Hovering checkbox input inside frame...\n")
                    checkbox.hover(timeout=5000)
                    page.wait_for_timeout(500)
                    sys.stderr.write("Clicking checkbox input inside frame naturally...\n")
                    checkbox.click(timeout=5000)
                    sys.stderr.write("Clicked Turnstile checkbox input inside frame.\n")
                    page.wait_for_timeout(3000)
                    return True
            except Exception as e:
                sys.stderr.write(f"Failed to click checkbox input inside frame: {e}\n")

            try:
                iframe_locator = page.locator("iframe[src*='challenges.cloudflare.com']:visible").first
                if iframe_locator.count() > 0:
                    sys.stderr.write("Clicking center-left of Turnstile iframe (offset x=180, y=32)...\n")
                    iframe_locator.click(position={'x': 180, 'y': 32}, timeout=3000)
                    page.wait_for_timeout(3000)
                    return True
            except Exception as e:
                sys.stderr.write(f"Failed fallback (coordinate click): {e}\n")
    except Exception as e:
        sys.stderr.write(f"Error in solve_embedded_turnstile: {e}\n")
    return False


def _setup_generic_route(page, target_url: str):
    """Set up route interception with a smart referer for any URL."""
    referer = _smart_referer(target_url)

    def handle_route(route, request):
        try:
            if is_ad_domain(request.url):
                try:
                    route.abort()
                except Exception:
                    pass
                return

            if request.is_navigation_request():
                headers = {**request.headers, "Referer": referer}
                route.continue_(headers=headers)
            else:
                route.continue_()
        except Exception:
            try:
                route.continue_()
            except Exception:
                pass

    try:
        page.route("**/*", handle_route)
    except Exception:
        pass


def is_ignored_download_url(url: str) -> bool:
    try:
        lower_path = urlparse(url).path.lower()
        ignored_extensions = {
            ".webmanifest", ".js", ".css", ".png", ".jpg", ".jpeg",
            ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2",
            ".ttf", ".otf", ".html", ".htm", ".txt", ".json", ".map"
        }
        return any(lower_path.endswith(ext) for ext in ignored_extensions)
    except Exception:
        return False


def is_ad_domain(url: str) -> bool:
    try:
        ad_keywords = [
            "opera.com", "adcash", "popunder", "clickunder", "acscdn",
            "adsterra", "doubleclick", "adsystem", "onclick", "traffic",
            "adnxs", "adform", "optimizely", "outbrain", "taboola",
            "revcontent", "mgid", "criteo", "google-analytics", "googletagmanager",
            "googlesyndication", "adservice", "adserver", "adskeeper", "popads",
            "propellerads", "exoclick", "a-ads", "amazon-adsystem", "pubmatic",
            "rubiconproject", "smartadserver", "openx", "bidswitch", "casalemedia"
        ]
        url_lower = url.lower()
        return any(kw in url_lower for kw in ad_keywords)
    except Exception:
        return False


def _strategy_response_listener(url: str, solve_cf: bool, expect_json: bool) -> str | None:
    captured_responses = []
    fetched_holder = {"text": None}
    captured_download = {"url": None}

    def page_setup(page):
        def on_response(response):
            try:
                response_url = getattr(response, "url", "") or ""
                response_status = getattr(response, "status", None)
                
                headers = getattr(response, "headers", {}) or {}
                content_disposition = headers.get("content-disposition", "")
                content_type = headers.get("content-type", "")
                
                if ("attachment" in content_disposition or "octet-stream" in content_type) and not is_ignored_download_url(response_url) and not is_ad_domain(response_url):
                    captured_download["url"] = response_url
                    return
                
                if "api/get-server" in response_url or "api/file" in response_url or "api/contents" in response_url:
                    captured_responses.append(response)
                    return
                
                is_target = (
                    response_url == url
                    or response_url.split("?")[0] == url.split("?")[0]
                )
                if not is_target:
                    return
                if response_status and int(response_status) not in (200, 307, 308):
                    return
                captured_responses.append(response)
            except Exception:
                pass

        def on_download(download):
            try:
                dl_url = download.url
                if not is_ad_domain(dl_url):
                    captured_download["url"] = dl_url
                    download.cancel()
            except Exception:
                pass

        def on_popup(popup):
            try:
                popup.on("download", on_download)
            except Exception:
                pass

        try:
            page.on("console", lambda msg: sys.stderr.write(f"CONSOLE: {msg.text}\n"))
            page.on("pageerror", lambda err: sys.stderr.write(f"PAGE ERROR: {err.message}\n"))
        except Exception:
            pass

        _setup_generic_route(page, url)

        try:
            page.on("response", on_response)
            page.on("download", on_download)
            page.on("popup", on_popup)
        except Exception:
            pass

    def page_action(page):
        try:
            page.wait_for_timeout(2000)
            solve_embedded_turnstile(page)
        except Exception:
            pass

        try:
            fetched = page.evaluate(JS_STREAM_FETCH, url)
            if isinstance(fetched, str) and fetched.strip():
                fetched_holder["text"] = fetched
        except Exception:
            pass

        try:
            combined_selector = (
                "a#download-link, #download-button, #download-btn, .download-button, "
                "a.download-btn, button#download-button, a[hx-get*='download'], [hx-get*='download']"
            )
            sys.stderr.write("Waiting for any download button/link to become visible...\n")
            page.wait_for_selector(combined_selector, state="visible", timeout=15000)
            sys.stderr.write("Download element is now visible!\n")
        except Exception as e:
            sys.stderr.write(f"Wait for download element visibility failed: {e}\n")

        try:
            for sel in ["a#download-link", "a[href*='/download/']", "a[href*='?download']", "a.download-btn"]:
                locator = page.locator(sel)
                count = locator.count()
                for i in range(count):
                    el = locator.nth(i)
                    if el.is_visible():
                        href = el.get_attribute("href")
                        if href:
                            href_str = str(href).strip()
                            if href_str and not href_str.startswith("#") and not href_str.startswith("javascript:"):
                                absolute_url = page.evaluate("href => new URL(href, window.location.href).href", href_str)
                                if "/download/" in absolute_url or "download" in absolute_url.lower():
                                    sys.stderr.write(f"Direct link found in href of '{sel}': {absolute_url}\n")
                                    captured_download["url"] = absolute_url
                                    return
        except Exception as e:
            sys.stderr.write(f"Failed to extract href directly: {e}\n")

        try:
            page.wait_for_timeout(2000)
            if captured_download["url"]:
                return
            
            selectors = [
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
                "a[href*='dl']"
            ]
            for selector in selectors:
                try:
                    elements = page.locator(selector)
                    count = elements.count()
                    for i in range(count):
                        el = elements.nth(i)
                        if el.is_visible():
                            try:
                                sys.stderr.write(f"Clicking element: {selector}\n")
                                el.click(timeout=3000, force=True)
                                page.wait_for_timeout(1000)
                                solve_embedded_turnstile(page)
                            except Exception as click_err:
                                sys.stderr.write(f"First click failed on {selector}: {click_err}\n")
                            
                            if not captured_download["url"]:
                                sys.stderr.write(f"Download not captured, retrying click on: {selector}\n")
                                try:
                                    el.click(timeout=3000, force=True)
                                    page.wait_for_timeout(2000)
                                    solve_embedded_turnstile(page)
                                except Exception as click_err:
                                    sys.stderr.write(f"Retry click failed on {selector}: {click_err}\n")
                                    
                            if captured_download["url"]:
                                return
                except Exception as loop_err:
                    sys.stderr.write(f"Error in selector loop for {selector}: {loop_err}\n")
        except Exception:
            pass

    kwargs = {
        "headless": True,
        "network_idle": False,
        "solve_cloudflare": solve_cf,
        "timeout": 25000,
        "page_setup": page_setup,
        "page_action": page_action,
        "google_search": False,
        "dns_over_https": True,
        "disable_ads": True,
    }

    page = StealthyFetcher.fetch(url, **kwargs)

    if captured_download["url"]:
        return captured_download["url"]

    for response in captured_responses:
        try:
            response_url = getattr(response, "url", "") or ""
            if "api/get-server" in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                if data.get("url"):
                    return data["url"]
                elif data.get("server") and data.get("hash"):
                    return f"{data['server'].rstrip('/')}/f/{data['hash']}"
            elif "api/file" in response_url or "api/contents" in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                if isinstance(data, dict):
                    for key in ["url", "downloadUrl", "directLink", "link"]:
                        if data.get(key):
                            return data[key]
                    if isinstance(data.get("data"), dict):
                        for key in ["url", "downloadUrl", "directLink", "link"]:
                            if data["data"].get(key):
                                return data["data"][key]
        except Exception:
            pass

    for response in captured_responses:
        body_method = getattr(response, "body", None)
        if callable(body_method):
            try:
                body_bytes = body_method() or b""
                if body_bytes:
                    decoded = body_bytes.decode("utf-8", "replace")
                    valid = get_valid_content(decoded, expect_json, ignore_turnstile=solve_cf)
                    if valid:
                        return valid
            except Exception:
                pass
        text_method = getattr(response, "text", None)
        if callable(text_method):
            try:
                body_text = text_method() or ""
                if body_text:
                    valid = get_valid_content(body_text, expect_json, ignore_turnstile=solve_cf)
                    if valid:
                        return valid
            except Exception:
                pass

    if fetched_holder["text"]:
        valid = get_valid_content(fetched_holder["text"], expect_json, ignore_turnstile=solve_cf)
        if valid:
            return valid

    body = extract_body(page)
    return get_valid_content(body, expect_json, ignore_turnstile=solve_cf)


def fetch_with_capture(url: str) -> str:
    expect_json = is_json_url(url)

    try:
        result = _strategy_response_listener(url, False, expect_json)
        if result:
            return result
    except Exception as e:
        sys.stderr.write(f"Initial strategy failed: {e}\n")

    sys.stderr.write(f"Retrying with Cloudflare solver enabled for: {url}\n")
    try:
        result = _strategy_response_listener(url, True, expect_json)
        if result:
            return result
    except Exception as e:
        sys.stderr.write(f"Retry with CF solver failed: {e}\n")

    raise RuntimeError(f"No se pudo obtener contenido válido de: {url}")


def write_stdout(text: str):
    if not text:
        return
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))


def main() -> int:
    import multiprocessing
    multiprocessing.freeze_support()

    _start_watchdog(PROCESS_TIMEOUT_SECONDS)

    ensure_fetchers_installed()

    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing url"}), file=sys.stderr)
        return 2
    url = sys.argv[1].strip()
    if not url:
        print(json.dumps({"error": "empty url"}), file=sys.stderr)
        return 2
    try:
        write_stdout(fetch_with_capture(url))
        return 0
    except Exception as exc:
        message = str(exc)
        if "Executable doesn't exist" not in message and "patchright install" not in message:
            print(message, file=sys.stderr)
            return 1
        try:
            ensure_browsers_installed()
            write_stdout(fetch_with_capture(url))
            return 0
        except Exception as retry_exc:
            print(str(retry_exc), file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())