"""Extractor for AkiraBox hosting platform (akirabox.to / akirabox.com)."""

import re
import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class AkiraBoxExtractor(BaseExtractor):
    """Handles AkiraBox links, Cloudflare Turnstile bypass, and direct CDN download resolution."""

    name: str = "akirabox"
    priority: int = 85
    requires_browser: bool = True  # Required for Cloudflare Turnstile and session clearance

    DOMAINS: tuple[str, ...] = (
        "akirabox.to",
        "akirabox.com",
    )
    DOWNLOAD_SELECTORS: tuple[str, ...] = (
        "#download-button",
        "a[href*='/download/']",
        "a.btn[href*='/download/']",
    )
    EXCLUDED_PATTERNS: tuple[str, ...] = (
        "favicon",
        "webmanifest",
        ".css",
        ".js",
        ".png",
        ".jpg",
        ".svg",
        ".ico",
        "turnstile",
        "challenge-platform",
    )
    MAX_WAIT_SECONDS: int = 20
    REGEX_DOWNLOAD_URL = re.compile(r'href=[\'"](https?://[^\'"]*akirabox\.[a-z]+/download/[^\'"]+)[\'"]')

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            if any(exc in response_url for exc in self.EXCLUDED_PATTERNS):
                return

            # 1. Standard Content-Disposition / direct download response
            captured = self.capture_direct_download_response(
                response, context, exclude_patterns=self.EXCLUDED_PATTERNS
            )
            if captured:
                return

            headers = getattr(response, "headers", {}) or {}

            # 2. Check for CDN upload URL
            if "/uploads/users/" in response_url:
                context.captured_download_url = response_url
                sys.stderr.write(f"[AkiraBox] Direct CDN link captured from response: {response_url}\n")
                return

            # 3. Check for 302 Redirect Location pointing to CDN storage
            status = getattr(response, "status", None)
            if status in (301, 302, 303, 307, 308):
                location = headers.get("location", "")
                if location and ("/uploads/users/" in location or "akirabox.com/uploads/" in location):
                    context.captured_download_url = location
                    sys.stderr.write(f"[AkiraBox] Captured CDN link from redirect location: {location}\n")
        except Exception as e:
            sys.stderr.write(f"[AkiraBox] Error in on_response: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            page.wait_for_timeout(1000)

            # 1. Solve Cloudflare Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=8)

            # 2. Poll specifically for the download button href
            for _ in range(self.MAX_WAIT_SECONDS):
                href = DomHelper.find_first_href(page, self.DOWNLOAD_SELECTORS)
                if href and "/download/" in href:
                    sys.stderr.write(f"[AkiraBox] Found signed download URL: {href}\n")

                    # 3. Resolve 302 redirect to storage edge CDN
                    try:
                        res = page.request.get(href, max_redirects=0)
                        if res.status in (301, 302, 303, 307, 308):
                            cdn_location = res.headers.get("location")
                            if cdn_location and "/uploads/users/" in cdn_location:
                                sys.stderr.write(f"[AkiraBox] Resolved CDN direct URL: {cdn_location}\n")
                                context.captured_download_url = cdn_location
                                return cdn_location
                    except Exception as req_err:
                        sys.stderr.write(f"[AkiraBox] Note resolving 302 redirect: {req_err}\n")

                    context.captured_download_url = href
                    return href

                page.wait_for_timeout(1000)

        except Exception as e:
            sys.stderr.write(f"[AkiraBox] Error in page_action: {e}\n")

        return context.captured_download_url

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Fallback to extract signed download link from raw DOM HTML."""
        if not content:
            return None
        match = self.REGEX_DOWNLOAD_URL.search(content)
        if match:
            url = match.group(1).replace("&amp;", "&")
            sys.stderr.write(f"[AkiraBox] Extracted download URL from HTML content: {url}\n")
            context.captured_download_url = url
            return url
        return None
