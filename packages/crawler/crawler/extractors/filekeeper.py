"""Extractor for FileKeeper hosting platform (filekeeper.net)."""

import json
import sys
from typing import Any

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class FileKeeperExtractor(BaseExtractor):
    """Handles FileKeeper links, 5-second countdown, and direct download capture."""

    name: str = "filekeeper"
    priority: int = 80
    requires_browser: bool = True  # FileKeeper is a Vue SPA with 5s countdown

    DOMAINS: tuple[str, ...] = ("filekeeper.net",)
    API_PATH_PATTERNS: tuple[str, ...] = ("api/file", "api/contents")
    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = (
        "filekeeper.net/vue_theme",
        "filekeeper.net/images",
    )

    READY_PATTERNS: tuple[str, ...] = ("Your download link is ready",)
    FREE_DOWNLOAD_PATTERNS: tuple[str, ...] = ("Free download", "Download")
    COUNTDOWN_WAIT_SECONDS: int = 8
    CAPTURE_WAIT_SECONDS: int = 6

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        url_lower = url.lower()
        return any(d in host for d in self.DOMAINS) or any(p in url_lower for p in self.API_PATH_PATTERNS)

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            # Check direct download or proxy response headers
            captured = self.capture_direct_download_response(
                response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
            )
            if captured:
                return

            # Check if JSON API response
            response_url = getattr(response, "url", "") or ""
            if any(p in response_url for p in self.API_PATH_PATTERNS):
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

            # 1. Wait for countdown to complete
            sys.stderr.write("[FileKeeper] Waiting for countdown to finish...\n")
            DomHelper.wait_for_text(page, self.READY_PATTERNS, timeout_seconds=self.COUNTDOWN_WAIT_SECONDS)

            # 2. Click the 'Free download' button
            sys.stderr.write("[FileKeeper] Clicking 'Free download' button...\n")
            DomHelper.click_button_with_text(page, self.FREE_DOWNLOAD_PATTERNS)

            # 3. Wait for direct download event or proxy response
            DomHelper.wait_for_capture(context, page, timeout_seconds=self.CAPTURE_WAIT_SECONDS)

        except Exception as e:
            sys.stderr.write(f"[FileKeeper] Error in page_action: {e}\n")

        return context.captured_download_url

    @staticmethod
    def _extract_url_from_data(data: Any) -> str | None:
        if not isinstance(data, dict):
            return None
        keys = ("url", "downloadUrl", "directLink", "link")
        for key in keys:
            if data.get(key):
                return str(data[key])
        nested_data = data.get("data")
        if isinstance(nested_data, dict):
            for key in keys:
                if nested_data.get(key):
                    return str(nested_data[key])
        return None
