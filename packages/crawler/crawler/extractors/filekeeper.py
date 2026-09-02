"""Extractor for FileKeeper hosting platform (filekeeper.net)."""

import json
import sys
from typing import Any

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class FileKeeperExtractor(BaseExtractor):
    """Handles FileKeeper links, 5-second countdown, and direct download capture."""

    name: str = "filekeeper"
    priority: int = 80
    requires_browser: bool = True  # FileKeeper is a Vue SPA with 5s countdown

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return "filekeeper.net" in host or "api/file" in url.lower() or "api/contents" in url.lower()

    def on_download(self, download, context: ExtractionContext) -> None:
        try:
            dl_url = download.url
            sys.stderr.write(f"[FileKeeper] Direct download captured from event: {dl_url}\n")
            context.captured_download_url = dl_url
            download.cancel()
        except Exception:
            pass

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            headers = getattr(response, "headers", {}) or {}
            cd = headers.get("content-disposition", "")
            ct = headers.get("content-type", "")

            # If response is a direct download link or proxy
            if ("attachment" in cd or "octet-stream" in ct or "dlproxy" in response_url) and response_url.startswith("http"):
                if "filekeeper.net/vue_theme" not in response_url and "filekeeper.net/images" not in response_url:
                    sys.stderr.write(f"[FileKeeper] Direct link captured from response: {response_url}\n")
                    context.captured_download_url = response_url
                    return

            # Check if JSON API response
            if "api/file" in response_url or "api/contents" in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                link = self._extract_url_from_data(data)
                if link:
                    context.captured_download_url = link
                    sys.stderr.write(f"[FileKeeper] Captured direct link from API: {link}\n")
        except Exception as e:
            sys.stderr.write(f"[FileKeeper] Error in on_response: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            page.wait_for_timeout(2000)

            # 1. Wait for 5-second countdown to complete
            sys.stderr.write("[FileKeeper] Waiting 5 seconds for countdown to finish...\n")
            for sec in range(8):
                page.wait_for_timeout(1000)
                if context.captured_download_url:
                    return context.captured_download_url

                ready = page.evaluate("""() => {
                    const btn = document.querySelector('#download-button, button.btn-primary');
                    const text = document.body.innerText;
                    return text.includes('Your download link is ready') || (btn && btn.offsetParent !== null && !btn.disabled);
                }""")
                if ready:
                    sys.stderr.write(f"[FileKeeper] Download link ready at {sec+1}s!\n")
                    break

            page.wait_for_timeout(1000)

            # 2. Click the 'Free download' button
            sys.stderr.write("[FileKeeper] Clicking 'Free download' button...\n")
            clicked = page.evaluate("""() => {
                const btn = document.querySelector('#download-button') || Array.from(document.querySelectorAll('button, a')).find(b => /free download/i.test(b.innerText));
                if (btn) {
                    btn.scrollIntoView();
                    btn.click();
                    return true;
                }
                return false;
            }""")

            if not clicked:
                try:
                    btn = page.locator("#download-button, button:has-text('Free download')").first
                    if btn.is_visible():
                        btn.click(force=True)
                except Exception:
                    pass

            # 3. Wait up to 6 seconds for direct download event or proxy response
            for _ in range(6):
                if context.captured_download_url:
                    return context.captured_download_url
                page.wait_for_timeout(1000)

        except Exception as e:
            sys.stderr.write(f"[FileKeeper] Error in page_action: {e}\n")

        return context.captured_download_url

    @staticmethod
    def _extract_url_from_data(data: Any) -> str | None:
        if not isinstance(data, dict):
            return None
        for key in ("url", "downloadUrl", "directLink", "link"):
            if data.get(key):
                return str(data[key])
        if isinstance(data.get("data"), dict):
            for key in ("url", "downloadUrl", "directLink", "link"):
                if data["data"].get(key):
                    return str(data["data"][key])
        return None
