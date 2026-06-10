#!/usr/bin/env python3

import json
import os
import re
import subprocess
import sys
import tempfile
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

CF_DOMAINS = {
    "hydralinks.cloud",
    "davidkazumisource.com",
}


def is_cloudflare_domain(url: str) -> bool:
    host = urlparse(url).netloc.lower().split(":")[0]
    return any(host == d or host.endswith("." + d) for d in CF_DOMAINS)


def is_json_url(url: str) -> bool:
    return urlparse(url).path.lower().endswith(".json")


def ensure_fetchers_installed():
    try:
        from scrapling.fetchers import StealthyFetcher  # noqa: F401
        return True
    except ModuleNotFoundError as exc:
        missing = str(exc)
        if "curl_cffi" not in missing and "scrapling.fetchers" not in missing:
            raise
    cmd = [sys.executable, "-m", "pip", "install", "--user", "scrapling[fetchers]"]
    result = subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
    if result.returncode != 0:
        raise RuntimeError(
            "No se pudieron instalar los extras de Scrapling.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return True


def ensure_browsers_installed():
    try:
        from scrapling.cli import install
        install([], standalone_mode=False)
        return
    except Exception:
        pass
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


ensure_fetchers_installed()
from scrapling.fetchers import StealthyFetcher  # noqa: E402

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


def get_valid_content(text: str, expect_json: bool) -> str | None:
    if not text or not text.strip():
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

    for attr in ("text", "html_content", "body", "content"):
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
            try:
                return value.decode("utf-8", "replace")
            except Exception:
                pass
        return str(value)

    try:
        if hasattr(page, "get_all_text"):
            return page.get_all_text()
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

    StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=False,
        solve_cloudflare=True,
        timeout=30000,
        page_action=page_action,
    )
    text = result_holder["text"]
    return get_valid_content(text, expect_json)


def _strategy_response_listener(url: str, solve_cf: bool, expect_json: bool) -> str | None:
    captured_fd, captured_path = tempfile.mkstemp(prefix="scrapling_capture_", suffix=".txt")
    os.close(captured_fd)
    captured_event = {"done": False}

    def page_setup(page):
        def on_response(response):
            if captured_event["done"]:
                return
            try:
                response_url = getattr(response, "url", "") or ""
                response_status = getattr(response, "status", None)
                is_target = (
                    response_url == url
                    or response_url.split("?")[0] == url.split("?")[0]
                )
                if not is_target:
                    return
                if response_status and int(response_status) not in (200, 307, 308):
                    return
                body_method = getattr(response, "body", None)
                if callable(body_method):
                    try:
                        body_bytes = body_method() or b""
                        if body_bytes:
                            with open(captured_path, "wb") as fh:
                                fh.write(body_bytes)
                            captured_event["done"] = True
                            return
                    except Exception:
                        pass
                text_method = getattr(response, "text", None)
                if callable(text_method):
                    try:
                        body_text = text_method() or ""
                        if body_text:
                            with open(captured_path, "w", encoding="utf-8") as fh:
                                fh.write(body_text)
                            captured_event["done"] = True
                    except Exception:
                        pass
            except Exception:
                pass
        try:
            page.on("response", on_response)
        except Exception:
            pass

    def page_action(page):
        if captured_event["done"]:
            return
        try:
            fetched = page.evaluate(JS_STREAM_FETCH, url)
            if isinstance(fetched, str) and fetched.strip():
                with open(captured_path, "w", encoding="utf-8") as fh:
                    fh.write(fetched)
                captured_event["done"] = True
        except Exception:
            pass

    page = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=False,
        solve_cloudflare=solve_cf,
        timeout=25000,
        page_setup=page_setup,
        page_action=page_action,
    )

    try:
        with open(captured_path, "r", encoding="utf-8") as fh:
            captured = fh.read()
        valid = get_valid_content(captured, expect_json)
        if valid:
            return valid
    except Exception:
        pass
    finally:
        try:
            os.remove(captured_path)
        except OSError:
            pass

    body = extract_body(page)
    return get_valid_content(body, expect_json)


def fetch_with_capture(url: str) -> str:
    solve_cf = is_cloudflare_domain(url)
    expect_json = is_json_url(url)

    if solve_cf and expect_json:
        try:
            result = _strategy_response_listener(url, True, expect_json)
            if result:
                return result
        except Exception as e:
            sys.stderr.write(f"Listener strategy failed: {e}\n")

        try:
            result = _strategy_browser_fetch(url, expect_json)
            if result:
                return result
        except Exception as e:
            sys.stderr.write(f"Browser fetch strategy failed: {e}\n")

        raise RuntimeError(f"No se pudo obtener contenido JSON válido de: {url}")

    result = _strategy_response_listener(url, solve_cf, expect_json)
    if result:
        return result
    raise RuntimeError(f"No se pudo obtener contenido de: {url}")


def write_stdout(text: str):
    if not text:
        return
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))


def main() -> int:
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