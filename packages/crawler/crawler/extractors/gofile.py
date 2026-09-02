"""Extractor for Gofile hosting platform (gofile.io)."""

import json
import sys

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class GofileExtractor(BaseExtractor):
    """Handles Gofile (gofile.io) links by loading the single-page app,

    clicking the file item, and capturing the direct store download URL and accountToken.
    """

    name: str = "gofile"
    priority: int = 90
    requires_browser: bool = True

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return "gofile.io" in host or "gofile" in host

    def on_setup(self, page, context: ExtractionContext) -> None:
        # Gofile does not use Cloudflare Turnstile; skip firewall waiting
        context.solve_cloudflare = False

    def on_download(self, download, context: ExtractionContext) -> None:
        try:
            dl_url = download.url
            sys.stderr.write(f"[Gofile] Direct download captured from event: {dl_url}\n")
            context.captured_download_url = dl_url
        except Exception as e:
            sys.stderr.write(f"[Gofile] Error handling download event: {e}\n")

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            resp_url = getattr(response, "url", "") or ""
            # 1. Direct download store link
            if "/download/web/" in resp_url:
                sys.stderr.write(f"[Gofile] Direct download captured from response: {resp_url}\n")
                context.captured_download_url = resp_url
                return

            # 2. Intercept contents API response which contains direct link in children
            if "api.gofile.io/contents/" in resp_url and not context.captured_download_url:
                try:
                    data = json.loads(response.text())
                    if data.get("status") == "ok" and "data" in data:
                        children = data["data"].get("children", {})
                        for child_id, child_info in children.items():
                            if child_info.get("type") == "file" and child_info.get("link"):
                                direct_link = child_info["link"]
                                sys.stderr.write(f"[Gofile] Found direct link in contents API: {direct_link}\n")
                                context.captured_download_url = direct_link
                                break
                except Exception:
                    pass
        except Exception as e:
            sys.stderr.write(f"[Gofile] Error in on_response: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> None:
        try:
            # Wire download event listener directly on page as well
            def handle_download(dl):
                try:
                    sys.stderr.write(f"[Gofile] Download event captured: {dl.url}\n")
                    context.captured_download_url = dl.url
                except Exception:
                    pass

            try:
                page.on("download", handle_download)
            except Exception:
                pass

            sys.stderr.write("[Gofile] Waiting for page items to render...\n")
            
            # Wait for file item buttons to appear (up to 10 seconds)
            file_selectors = [
                "button:has-text('.zip')",
                "button:has-text('.rar')",
                "button:has-text('.7z')",
                "button:has-text('.iso')",
                "button:has-text('.exe')",
                "button.cursor-pointer",
                "button:has-text('Download')",
                "a:has-text('Download')",
            ]

            clicked = False
            for _ in range(10):
                for sel in file_selectors:
                    elements = page.locator(sel)
                    if elements.count() > 0:
                        first_el = elements.first
                        if first_el.is_visible():
                            try:
                                btn_text = first_el.inner_text().strip().replace("\n", " ")
                                sys.stderr.write(f"[Gofile] Clicking file button: '{btn_text[:60]}'\n")
                                first_el.click()
                                clicked = True
                                break
                            except Exception as click_err:
                                sys.stderr.write(f"[Gofile] Click attempt error: {click_err}\n")
                if clicked:
                    break
                page.wait_for_timeout(1000)

            # Wait up to 6 seconds for download URL to be captured
            for _ in range(6):
                if context.captured_download_url:
                    break
                page.wait_for_timeout(1000)

            # Extract the accountToken cookie from browser context
            account_token = ""
            for cookie in page.context.cookies():
                if cookie.get("name") == "accountToken":
                    account_token = cookie.get("value", "")
                    break

            sys.stderr.write(f"[Gofile] Captured accountToken: {account_token[:15]}...\n")

            # If we captured a direct URL, package with accountToken as JSON
            if context.captured_download_url:
                raw_url = context.captured_download_url
                if not raw_url.startswith("{"):
                    context.captured_download_url = json.dumps({
                        "url": raw_url,
                        "token": account_token
                    })
                sys.stderr.write(f"[Gofile] Result packaged successfully.\n")

        except Exception as e:
            sys.stderr.write(f"[Gofile] Error in page_action: {e}\n")
