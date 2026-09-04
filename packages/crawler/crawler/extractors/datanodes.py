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
    STEP1_ENABLE_TIMEOUT_SECONDS: int = 15
    STEP1_NAV_TIMEOUT_SECONDS: int = 15

    # Step 2: Download buttons & countdown
    STEP2_INDICATORS: tuple[str, ...] = ("Step 2 of 2",)
    FREE_DOWNLOAD_PATTERNS: tuple[str, ...] = ("Free Download", "Standard speed")
    FREE_DOWNLOAD_EXCLUDE_PATTERNS: tuple[str, ...] = ("continue",)
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
    COUNTDOWN_WAIT_SECONDS: int = 30
    CAPTURE_WAIT_SECONDS: int = 8

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
            has_step1 = DomHelper.has_text(page, self.STEP1_INDICATORS) or DomHelper.exists(page, self.STEP1_BUTTON_SELECTOR)
            if has_step1:
                sys.stderr.write("[DataNodes] Detected Step 1 (File Verification). Waiting for check to finish...\n")
                TurnstileSolver.solve_if_present(page, timeout_seconds=8)
                # Wait for #method_free button to be enabled by page verification timer
                DomHelper.wait_until_enabled(
                    page, self.STEP1_BUTTON_SELECTOR, timeout_seconds=self.STEP1_ENABLE_TIMEOUT_SECONDS
                )
                sys.stderr.write("[DataNodes] Clicking 'Continue to Download' (#method_free) and waiting for Step 2...\n")
                DomHelper.click_and_wait_navigation(
                    page,
                    self.STEP1_BUTTON_SELECTOR,
                    timeout_seconds=self.STEP1_NAV_TIMEOUT_SECONDS,
                    fallback_indicators=self.STEP2_INDICATORS,
                )
                page.wait_for_timeout(1500)

            if context.captured_download_url:
                return context.captured_download_url

            # 2. Check Turnstile on Step 2 (if present)
            TurnstileSolver.solve_if_present(page, timeout_seconds=10)

            if context.captured_download_url:
                return context.captured_download_url

            # 3. Click 'Free Download' button on Step 2 to initiate countdown
            sys.stderr.write("[DataNodes] Clicking 'Free Download' button on Step 2...\n")
            DomHelper.click_button_with_text(
                page,
                patterns=self.FREE_DOWNLOAD_PATTERNS,
                exclude_patterns=self.FREE_DOWNLOAD_EXCLUDE_PATTERNS,
            )

            # 4. Wait for countdown and trigger final download
            sys.stderr.write("[DataNodes] Waiting for countdown...\n")
            DomHelper.wait_and_click_button(
                page,
                patterns=self.FINAL_DOWNLOAD_PATTERNS,
                exclude_patterns=self.FINAL_EXCLUDE_PATTERNS,
                max_wait_seconds=self.COUNTDOWN_WAIT_SECONDS,
                context=context,
            )

            # 5. Final wait for network/event capture
            DomHelper.wait_for_capture(context, page, timeout_seconds=self.CAPTURE_WAIT_SECONDS)

        except Exception as e:
            sys.stderr.write(f"[DataNodes] Error in page_action: {e}\n")

        return context.captured_download_url
