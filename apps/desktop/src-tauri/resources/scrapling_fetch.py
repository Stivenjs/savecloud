#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import tempfile


def ensure_fetchers_installed():
    try:
        from scrapling.fetchers import StealthyFetcher  # noqa: F401
        return True
    except ModuleNotFoundError as exc:
        missing = str(exc)
        if "curl_cffi" not in missing and "scrapling.fetchers" not in missing:
            raise

    cmd = [sys.executable, "-m", "pip", "install", "--user", "scrapling[fetchers]"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "No se pudieron instalar los extras de Scrapling (scrapling[fetchers]).\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    return True


def ensure_browsers_installed():
    try:
        from scrapling.cli import install

        install([], standalone_mode=False)
        return
    except Exception as exc:
        pass

    install_cmds = [
        [sys.executable, "-m", "scrapling.cli", "install"],
        [sys.executable, "-m", "scrapling.cli", "install", "--force"],
    ]

    last_error = None
    for cmd in install_cmds:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return
        last_error = (
            "No se pudieron instalar los navegadores de Scrapling.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    raise RuntimeError(last_error or "No se pudieron instalar los navegadores de Scrapling.")


ensure_fetchers_installed()

from scrapling.fetchers import StealthyFetcher


def extract_body(page):
    for attr in ("html_content", "content", "text"):
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
            return value.decode("utf-8", "replace")
        return str(value)

    try:
        return page.get_all_text()
    except Exception:
        return str(page)


def fetch_with_capture(url: str):
    captured_path = tempfile.mkstemp(prefix="scrapling_capture_", suffix=".txt")[1]

    def capture_text(text):
        if not text:
            return
        with open(captured_path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def page_setup(page):
        def on_response(response):
            try:
                response_url = getattr(response, "url", "") or ""
                response_status = getattr(response, "status", None)
                headers = {}
                try:
                    headers = dict(getattr(response, "headers", {}) or {})
                except Exception:
                    headers = {}

                content_type = str(headers.get("content-type", "") or headers.get("Content-Type", "")).lower()
                is_target = response_url == url or response_url.split("?")[0] == url.split("?")[0]
                if not is_target:
                    return
                if response_status and int(response_status) not in (200, 307, 308):
                    return

                body_bytes = b""
                body_method = getattr(response, "body", None)
                if callable(body_method):
                    body_bytes = body_method() or b""
                if body_bytes:
                    with open(captured_path, "wb") as handle:
                        handle.write(body_bytes)
                    return

                body_text = ""
                text_method = getattr(response, "text", None)
                if callable(text_method):
                    body_text = text_method() or ""
                if body_text:
                    with open(captured_path, "w", encoding="utf-8") as handle:
                        handle.write(body_text)
                    return

                body_bytes = getattr(response, "body", b"") or b""
                if body_bytes:
                    with open(captured_path, "wb") as handle:
                        handle.write(body_bytes)
                    return

                if "json" in content_type:
                    with open(captured_path, "w", encoding="utf-8") as handle:
                        handle.write(text_method() if callable(text_method) else "")
            except Exception:
                return

        try:
            page.on("response", on_response)
        except Exception:
            pass

    def page_action(page):
        try:
            fetched_text = page.evaluate(
                """async (targetUrl) => {
                    const response = await fetch(targetUrl, { credentials: 'include' });
                    return await response.text();
                }""",
                url,
            )
            if isinstance(fetched_text, str) and fetched_text.strip():
                capture_text(fetched_text)
        except Exception:
            pass

    page = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        solve_cloudflare=True,
        timeout=60000,
        page_setup=page_setup,
        page_action=page_action,
    )

    if os.path.exists(captured_path):
        try:
            with open(captured_path, "r", encoding="utf-8") as handle:
                captured = handle.read()
            if captured.strip():
                return captured
        finally:
            try:
                os.remove(captured_path)
            except OSError:
                pass

    return extract_body(page)


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
        missing_browser = "Executable doesn't exist" in message or "patchright install" in message
        if not missing_browser:
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