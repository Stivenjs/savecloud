"""Extractor for Gofile hosting platform (gofile.io)."""

import json
import sys

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class GofileExtractor(BaseExtractor):
    """Handles Gofile (gofile.io) links by loading the single-page app,
    clicking the file item, and capturing the direct store download URL and accountToken.
    """

    name: str = "gofile"
    priority: int = 90
    requires_browser: bool = True

    DOMAINS: tuple[str, ...] = ("gofile.io", "gofile")
    STORE_DOWNLOAD_PATH: str = "/download/web/"
    CONTENTS_API_PREFIX: str = "api.gofile.io/contents/"
    FILE_EXTENSIONS: tuple[str, ...] = (".zip", ".rar", ".7z", ".iso", ".exe")
    FILE_ITEM_SELECTORS: tuple[str, ...] = tuple(
        f"button:has-text('{ext}')" for ext in FILE_EXTENSIONS
    ) + (
        "button.cursor-pointer",
        "button:has-text('Download')",
        "a:has-text('Download')",
    )
    ACCOUNT_TOKEN_COOKIE: str = "accountToken"
    FILE_RENDER_WAIT_SECONDS: int = 10
    CAPTURE_WAIT_SECONDS: int = 6

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_setup(self, page, context: ExtractionContext) -> None:
        # Gofile does not use Cloudflare Turnstile; skip firewall waiting
        context.solve_cloudflare = False

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            resp_url = getattr(response, "url", "") or ""
            # 1. Direct download store link
            if self.STORE_DOWNLOAD_PATH in resp_url:
                sys.stderr.write(f"[Gofile] Direct download captured from response: {resp_url}\n")
                context.captured_download_url = resp_url
                return

            # 2. Intercept contents API response which contains direct link in children
            if self.CONTENTS_API_PREFIX in resp_url and not context.captured_download_url:
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
            sys.stderr.write("[Gofile] Waiting for page items to render...\n")

            # Click the first visible file button
            for _ in range(self.FILE_RENDER_WAIT_SECONDS):
                if DomHelper.click_first_visible(page, self.FILE_ITEM_SELECTORS):
                    break
                page.wait_for_timeout(1000)

            # Wait for download URL to be captured
            DomHelper.wait_for_capture(context, page, timeout_seconds=self.CAPTURE_WAIT_SECONDS)

            # Extract the accountToken cookie from browser context
            account_token = ""
            for cookie in page.context.cookies():
                if cookie.get("name") == self.ACCOUNT_TOKEN_COOKIE:
                    account_token = cookie.get("value", "")
                    break

            if account_token:
                sys.stderr.write(f"[Gofile] Captured accountToken: {account_token[:15]}...\n")

            # Package with accountToken as JSON if captured
            if context.captured_download_url:
                raw_url = context.captured_download_url
                if not raw_url.startswith("{"):
                    context.captured_download_url = json.dumps({
                        "url": raw_url,
                        "token": account_token,
                    })
                sys.stderr.write("[Gofile] Result packaged successfully.\n")

        except Exception as e:
            sys.stderr.write(f"[Gofile] Error in page_action: {e}\n")
