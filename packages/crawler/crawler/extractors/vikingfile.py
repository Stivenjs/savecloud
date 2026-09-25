"""Extractor for VikingFile hosting platform."""

import json
import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class VikingFileExtractor(BaseExtractor):
    """Handles VikingFile links, Cloudflare Turnstile solving, and direct download links."""

    name: str = "vikingfile"
    priority: int = 85
    requires_browser: bool = True

    DOMAINS: tuple[str, ...] = (
        "vikingfile.com",
        "vik1ngfile.site",
        "vik1ngfile",
        "vikingfile",
    )
    API_PATH: str = "api/get-server"
    DOWNLOAD_SELECTORS: tuple[str, ...] = (
        "#download-link",
        "a.button[href*='/d/']",
        "a[href*='/f/']",
    )
    MAX_WAIT_SECONDS: int = 25

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS) or self.API_PATH in url.lower()

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            if self.API_PATH in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                if data.get("url"):
                    context.captured_download_url = data["url"]
                    sys.stderr.write(f"[VikingFile] Found direct url in API response: {data['url']}\n")
                elif data.get("server") and data.get("hash"):
                    resolved = f"{data['server'].rstrip('/')}/f/{data['hash']}"
                    context.captured_download_url = resolved
                    sys.stderr.write(f"[VikingFile] Built direct url from server and hash: {resolved}\n")
            elif getattr(response, "request", None) and getattr(response.request, "method", "") == "POST":
                # Intercept Turnstile callback POST response {"link": "https://..."}
                try:
                    data = json.loads(response.text())
                    if data.get("link"):
                        context.captured_download_url = data["link"]
                        sys.stderr.write(f"[VikingFile] Captured direct link from Turnstile response: {data['link']}\n")
                except Exception:
                    pass
        except Exception as e:
            sys.stderr.write(f"[VikingFile] Error parsing response: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> None:
        try:
            sys.stderr.write("[VikingFile] Page loaded, checking Turnstile...\n")
            page.wait_for_timeout(2000)

            # 1. Attempt Turnstile solve
            TurnstileSolver.solve_if_present(page, timeout_seconds=6)

            # 2. Wait for direct download link href or download event
            DomHelper.poll_for_href(
                page,
                self.DOWNLOAD_SELECTORS,
                context=context,
                max_wait_seconds=self.MAX_WAIT_SECONDS,
            )

        except Exception as e:
            sys.stderr.write(f"[VikingFile] Error in page_action: {e}\n")
