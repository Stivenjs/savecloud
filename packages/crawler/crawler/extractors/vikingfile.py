"""Extractor for VikingFile hosting platform."""

import json
import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class VikingFileExtractor(BaseExtractor):
    """Handles VikingFile links, Cloudflare Turnstile solving, and direct download links."""

    name: str = "vikingfile"
    priority: int = 85
    requires_browser: bool = True

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return (
            "vikingfile.com" in host
            or "vik1ngfile.site" in host
            or "vik1ngfile" in host
            or "vikingfile" in host
            or "api/get-server" in url.lower()
        )

    def on_download(self, download, context: ExtractionContext) -> None:
        try:
            dl_url = download.url
            sys.stderr.write(f"[VikingFile] Direct download captured from event: {dl_url}\n")
            context.captured_download_url = dl_url
        except Exception as e:
            sys.stderr.write(f"[VikingFile] Error handling download event: {e}\n")

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            if "api/get-server" in response_url:
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
            sys.stderr.write("[VikingFile] Page loaded, waiting for Turnstile widget...\n")
            page.wait_for_timeout(2000)

            # Attempt Turnstile solve
            TurnstileSolver.solve(page)

            # Wait up to 25 seconds for the direct download link or download event
            for _ in range(25):
                if context.captured_download_url:
                    break

                page.wait_for_timeout(1000)

                # Check if download link button has been populated
                link = page.query_selector("#download-link")
                if link:
                    href = link.get_attribute("href")
                    if href and href.startswith("http"):
                        context.captured_download_url = href
                        sys.stderr.write(f"[VikingFile] Found download link href: {href}\n")
                        break

                # Also check any direct download buttons
                direct_btn = page.query_selector("a.button[href*='/d/']")
                if direct_btn:
                    href = direct_btn.get_attribute("href")
                    if href and href.startswith("http"):
                        context.captured_download_url = href
                        sys.stderr.write(f"[VikingFile] Found direct button href: {href}\n")
                        break

        except Exception as e:
            sys.stderr.write(f"[VikingFile] Error in page_action: {e}\n")
