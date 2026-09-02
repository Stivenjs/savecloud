"""Extractor for DataNodes hosting platform (datanodes.to)."""

import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class DataNodesExtractor(BaseExtractor):
    """Handles DataNodes (datanodes.to) links, Step 1 verification, Turnstile, and countdown."""

    name: str = "datanodes"
    priority: int = 85
    requires_browser: bool = True
    browser_timeout_ms: int = 60000

    # Domain matching
    DOMAINS: tuple[str, ...] = ("datanodes.to", "datanodes")

    # Step 1: Prelim / File Verification
    STEP1_BUTTON_SELECTOR: str = "#method_free"
    STEP1_INDICATORS: tuple[str, ...] = (
        "Continue to Download",
        "Step 1 of 2",
        "File Verification",
        "Preparing Download",
    )

    # Step 2: Download buttons & countdown
    FREE_DOWNLOAD_PATTERNS: tuple[str, ...] = ("Free Download", "Standard speed")
    FINAL_DOWNLOAD_PATTERNS: tuple[str, ...] = (
        "Download started",
        "Didn't start",
        "Start Download",
        "Download",
        "Descargar",
    )
    FINAL_EXCLUDE_PATTERNS: tuple[str, ...] = (
        "premium",
        "torrent",
        "app",
        "skip",
        "discord",
        "steamgg",
    )

    # URL exclusions for network response sniffer
    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = ("datanodes.to/theme",)

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_response(self, response, context: ExtractionContext) -> None:
        self.capture_direct_download_response(
            response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
        )

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            page.wait_for_timeout(1500)
            if context.captured_download_url:
                return context.captured_download_url

            # 1. Handle Step 1 (File Verification screen) if present
            if DomHelper.has_text(page, self.STEP1_INDICATORS) or DomHelper.exists(page, self.STEP1_BUTTON_SELECTOR):
                sys.stderr.write("[DataNodes] Detected Step 1 (File Verification). Waiting for check to finish...\n")
                DomHelper.wait_until_enabled(page, self.STEP1_BUTTON_SELECTOR, timeout_seconds=10)
                DomHelper.click(page, self.STEP1_BUTTON_SELECTOR, force_enable=True)
                DomHelper.wait_for_text(page, self.FREE_DOWNLOAD_PATTERNS, timeout_seconds=10)

            if context.captured_download_url:
                return context.captured_download_url

            # 2. Solve Cloudflare Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=12)
            if context.captured_download_url:
                return context.captured_download_url

            # 3. Click 'Free Download' button to initiate countdown
            sys.stderr.write("[DataNodes] Clicking 'Free Download' button...\n")
            DomHelper.click_button_with_text(
                page,
                patterns=self.FREE_DOWNLOAD_PATTERNS,
                exclude_patterns=("continue",),
            )

            # 4. Wait for countdown and trigger final download
            sys.stderr.write("[DataNodes] Waiting for countdown...\n")
            DomHelper.wait_and_click_button(
                page,
                patterns=self.FINAL_DOWNLOAD_PATTERNS,
                exclude_patterns=self.FINAL_EXCLUDE_PATTERNS,
                max_wait_seconds=18,
                context=context,
            )

            # 5. Final wait for network/event capture
            DomHelper.wait_for_capture(context, page, timeout_seconds=8)

        except Exception as e:
            sys.stderr.write(f"[DataNodes] Error in page_action: {e}\n")

        return context.captured_download_url
