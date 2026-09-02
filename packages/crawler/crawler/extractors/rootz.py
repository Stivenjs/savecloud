"""Extractor for Rootz hosting platform."""

import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class RootzExtractor(BaseExtractor):
    """Handles Rootz links and specific download button clicks."""

    name: str = "rootz"
    priority: int = 80

    def matches(self, url: str) -> bool:
        return "rootz.so" in extract_host(url)

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            # Check for direct download link in page first
            direct_selectors = [
                "a[href*='/download/']",
                "a.btn-download",
                "#download-btn",
                "a[download]",
            ]
            for sel in direct_selectors:
                elements = page.locator(sel)
                if elements.count() > 0 and elements.first.is_visible():
                    href = elements.first.get_attribute("href")
                    if href and href.startswith("http"):
                        context.captured_download_url = href
                        return href

            TurnstileSolver.solve(page)

            # Click Rootz download button
            btn = page.locator("#download-btn, button:has-text('Download'), a:has-text('Download')").first
            if btn.count() > 0 and btn.is_visible():
                btn.click(timeout=3000, force=True)
                page.wait_for_timeout(500)
                TurnstileSolver.solve(page)
        except Exception as e:
            sys.stderr.write(f"[Rootz] page_action error: {e}\n")

        return context.captured_download_url
