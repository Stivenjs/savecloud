"""Extractor for Rootz hosting platform."""

import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class RootzExtractor(BaseExtractor):
    """Handles Rootz links and specific download button clicks."""

    name: str = "rootz"
    priority: int = 80

    DOMAINS: tuple[str, ...] = ("rootz.so",)
    DIRECT_LINK_SELECTORS: tuple[str, ...] = (
        "a[href*='/download/']",
        "a.btn-download",
        "#download-btn",
        "a[download]",
    )
    DOWNLOAD_BUTTON_SELECTORS: tuple[str, ...] = (
        "#download-btn",
        "button:has-text('Download')",
        "a:has-text('Download')",
    )

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            # 1. Check for direct download link in page first
            direct_url = DomHelper.find_first_href(page, self.DIRECT_LINK_SELECTORS)
            if direct_url:
                context.captured_download_url = direct_url
                return direct_url

            # 2. Solve Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=4)

            # 3. Click Rootz download button
            DomHelper.click_first_visible(page, self.DOWNLOAD_BUTTON_SELECTORS)
            page.wait_for_timeout(500)
            TurnstileSolver.solve_if_present(page, timeout_seconds=2)

        except Exception as e:
            sys.stderr.write(f"[Rootz] page_action error: {e}\n")

        return context.captured_download_url
