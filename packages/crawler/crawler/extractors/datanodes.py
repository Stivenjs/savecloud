"""Extractor for DataNodes hosting platform (datanodes.to)."""

import json
import sys
from urllib.parse import unquote

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host, is_ad_domain
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class DataNodesExtractor(BaseExtractor):
    """Handles DataNodes (datanodes.to) links, Step 1 verification, Turnstile, and countdown."""

    name: str = "datanodes"
    priority: int = 85
    requires_browser: bool = True
    browser_timeout_ms: int = 60000
    intercept_routes: bool = False  # Use specialized route interception to prevent ad hijack

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

    # First button: Click to initiate countdown
    FREE_DOWNLOAD_PATTERNS: tuple[str, ...] = ("Free Download", "Standard speed")
    FREE_DOWNLOAD_EXCLUDE_PATTERNS: tuple[str, ...] = ("continue", "premium", "torrent")

    # Second button: Appears after countdown reaches 0s ("Start Download" / "Your file is ready")
    START_DOWNLOAD_PATTERNS: tuple[str, ...] = (
        "Start Download",
        "Your file is ready",
    )
    START_DOWNLOAD_EXCLUDE_PATTERNS: tuple[str, ...] = (
        "premium",
        "torrent",
        "app",
        "skip",
        "discord",
        "steamgg",
        "preparing your download",
        "ready in",
    )

    # Post-click state and retry
    RETRY_DOWNLOAD_PATTERNS: tuple[str, ...] = (
        "Didn't start",
        "Click to retry",
    )

    COUNTDOWN_WAIT_SECONDS: int = 35
    CAPTURE_WAIT_SECONDS: int = 10

    # URL exclusions for network response sniffer
    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = ("datanodes.to/theme",)

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_setup(self, page, context: ExtractionContext) -> None:
        """Neutralizes click popups and isolates network requests from aggressive ad scripts."""
        try:
            page.add_init_script("window.open = function() { return null; };")
        except Exception:
            pass

        def handle_route(route, request):
            try:
                req_url = request.url.lower()
                res_type = request.resource_type

                if is_ad_domain(req_url):
                    route.abort()
                    return

                # Block third-party scripts from hijacking page timer or redirecting location
                if res_type == "script":
                    if "datanodes" not in req_url and "cloudflare.com" not in req_url:
                        route.abort()
                        return

                if res_type in ("image", "media", "font"):
                    route.abort()
                    return

                # Block navigation to ad domains
                if request.is_navigation_request():
                    is_safe_nav = (
                        "datanodes" in req_url
                        or "cloudflare.com" in req_url
                        or "dlproxy" in req_url
                        or any(ext in req_url for ext in (".zip", ".rar", ".7z", ".exe", "/download/"))
                    )
                    if not is_safe_nav:
                        route.abort()
                        return

                route.continue_()
            except Exception:
                try:
                    route.continue_()
                except Exception:
                    pass

        try:
            page.route("**/*", handle_route)
        except Exception:
            pass

    def on_response(self, response, context: ExtractionContext) -> None:
        self.capture_direct_download_response(
            response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
        )
        if context.captured_download_url:
            return

        # Check JSON response from the download2 POST request
        try:
            headers = getattr(response, "headers", {}) or {}
            content_type = headers.get("content-type", "")
            if "application/json" in content_type:
                text_getter = getattr(response, "text", None)
                body_text = text_getter() if callable(text_getter) else ""
                if body_text and '"url":' in body_text:
                    data = json.loads(body_text)
                    if data.get("url"):
                        direct_url = unquote(data["url"])
                        sys.stderr.write(f"[DataNodes] Direct link captured from JSON response: {direct_url}\n")
                        context.captured_download_url = direct_url
        except Exception:
            pass

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

            # 3. If 'Start Download' is not yet present, click 'Free Download' to start countdown
            if not DomHelper.has_text(page, self.START_DOWNLOAD_PATTERNS):
                sys.stderr.write("[DataNodes] Clicking 'Free Download' button on Step 2 to initiate countdown...\n")
                DomHelper.click_button_with_text(
                    page,
                    patterns=self.FREE_DOWNLOAD_PATTERNS,
                    exclude_patterns=self.FREE_DOWNLOAD_EXCLUDE_PATTERNS,
                )

            # 4. Wait for countdown to finish and click 'Start Download' / 'Your file is ready'
            sys.stderr.write("[DataNodes] Waiting for countdown to finish and 'Start Download' button to appear...\n")
            clicked_start = DomHelper.wait_and_click_button(
                page,
                patterns=self.START_DOWNLOAD_PATTERNS,
                exclude_patterns=self.START_DOWNLOAD_EXCLUDE_PATTERNS,
                max_wait_seconds=self.COUNTDOWN_WAIT_SECONDS,
                context=context,
            )
            if clicked_start:
                sys.stderr.write("[DataNodes] Clicked 'Start Download' button successfully!\n")

            # 5. Wait for network/event capture and trigger retry if download didn't start
            for _ in range(self.CAPTURE_WAIT_SECONDS):
                if context.captured_download_url:
                    break
                if DomHelper.has_text(page, self.RETRY_DOWNLOAD_PATTERNS):
                    DomHelper.click_button_with_text(page, patterns=self.RETRY_DOWNLOAD_PATTERNS)
                page.wait_for_timeout(1000)

        except Exception as e:
            sys.stderr.write(f"[DataNodes] Error in page_action: {e}\n")

        return context.captured_download_url

