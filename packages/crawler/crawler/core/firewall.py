"""Detection of anti-bot firewalls (Cloudflare, AWS WAF) and Turnstile solver."""

import json
import sys

from crawler.config import (
    FIREWALL_KEYWORDS,
    TURNSTILE_CHECKBOX_OFFSET_X,
    TURNSTILE_CHECKBOX_OFFSET_Y,
    TURNSTILE_CHECKBOX_SELECTORS,
    TURNSTILE_FRAME_SUBSTRING,
    TURNSTILE_OVERLAY_SELECTORS,
    TURNSTILE_READY_DOWNLOAD_SELECTORS,
    TURNSTILE_RESPONSE_INPUT,
)
from crawler.core.reporter import CrawlerReporter
from crawler.utils.dom import DomHelper
from crawler.utils.json_cleaner import clean_json_from_html


class FirewallDetector:
    """Detects WAF and bot challenge pages."""

    @staticmethod
    def is_challenge(text: str, ignore_turnstile: bool = False) -> bool:
        if not text:
            return False
        lower = text.lower()
        if not (
            "<html" in lower
            or "<!doctype" in lower
            or "<head" in lower
            or "<body" in lower
        ):
            return False

        if not ignore_turnstile:
            if (
                "cf-turnstile" in lower
                or "cf_chl" in lower
                or "cf-browser-verification" in lower
                or ("cloudflare" in lower and "turnstile" in lower)
            ):
                return True

        return any(kw in lower for kw in FIREWALL_KEYWORDS if not (ignore_turnstile and "turnstile" in kw))

    @classmethod
    def validate_content(
        cls, text: str | None, expect_json: bool, ignore_turnstile: bool = False
    ) -> str | None:
        """Validates that text is not a firewall challenge and matches expectations."""
        if not text or not text.strip():
            return None

        if cls.is_challenge(text, ignore_turnstile=ignore_turnstile):
            return None

        if expect_json:
            cleaned = clean_json_from_html(text)
            if cleaned.startswith("{") or cleaned.startswith("["):
                try:
                    json.loads(cleaned)
                    return cleaned
                except Exception:
                    pass
            return None

        return text


class TurnstileSolver:
    """Interacts with embedded Cloudflare Turnstile iframes to complete challenges."""

    @staticmethod
    def solve(page, reported: bool = False) -> bool:
        try:
            # If download action is already visible, challenge is bypassed
            if DomHelper.is_any_visible(page, TURNSTILE_READY_DOWNLOAD_SELECTORS):
                return True

            cf_frame = next(
                (f for f in page.frames if TURNSTILE_FRAME_SUBSTRING in f.url), None
            )

            if not reported:
                CrawlerReporter.report("turnstile", "Resolving Cloudflare Turnstile...")
                sys.stderr.write(
                    "Found embedded Cloudflare Turnstile iframe, attempting to solve...\n"
                )

            # Remove overlays or anti-click layers if present
            DomHelper.remove_elements(page, TURNSTILE_OVERLAY_SELECTORS)

            # 1. Try to click checkbox inside frame with shadow DOM piercing
            if cf_frame:
                for selector in TURNSTILE_CHECKBOX_SELECTORS:
                    try:
                        loc = cf_frame.locator(selector).first
                        if loc.count() > 0 and loc.is_visible():
                            if DomHelper.smooth_click_locator(page, loc):
                                page.wait_for_timeout(1500)
                                return True
                    except Exception:
                        continue

            # 2. Fallback: click directly on the iframe at standard checkbox coordinates
            try:
                iframe_loc = page.locator(
                    f"iframe[src*='{TURNSTILE_FRAME_SUBSTRING}']:visible"
                ).first
                if iframe_loc.count() > 0:
                    if DomHelper.smooth_click_locator(
                        page,
                        iframe_loc,
                        offset_x=TURNSTILE_CHECKBOX_OFFSET_X,
                        offset_y=TURNSTILE_CHECKBOX_OFFSET_Y,
                    ):
                        page.wait_for_timeout(2000)
                        return True
            except Exception as e:
                sys.stderr.write(f"Error clicking iframe locator: {e}\n")

        except Exception as e:
            sys.stderr.write(f"Error in solve_embedded_turnstile: {e}\n")
        return False

    @classmethod
    def is_solved(cls, page) -> bool:
        """Checks if Turnstile has already been successfully solved on the page."""
        return DomHelper.has_input_value(page, TURNSTILE_RESPONSE_INPUT, min_length=20)

    @classmethod
    def solve_if_present(cls, page, timeout_seconds: int = 15) -> bool:
        """Quickly detects if Turnstile is present and attempts to solve it."""
        try:
            
            if getattr(page, "_turnstile_handled", False):
                return True

            has_turnstile = (
                DomHelper.has_iframe_src(page, TURNSTILE_FRAME_SUBSTRING)
                or DomHelper.exists(page, TURNSTILE_RESPONSE_INPUT)
            )
            if not has_turnstile:
                return False

            reported = False
            for sec in range(timeout_seconds):
                if not reported:
                    reported = True
                    CrawlerReporter.report("turnstile", "Resolving Cloudflare Turnstile...")

                if cls.is_solved(page):
                    CrawlerReporter.report(
                        "turnstile_solved", "Cloudflare Turnstile verified successfully"
                    )
                    sys.stderr.write("[Turnstile] Verified successfully!\n")
                    setattr(page, "_turnstile_handled", True)
                    page.wait_for_timeout(600)
                    return True

                cls.solve(page, reported=True)

                if cls.is_solved(page):
                    CrawlerReporter.report(
                        "turnstile_solved", "Cloudflare Turnstile verified successfully"
                    )
                    sys.stderr.write("[Turnstile] Verified successfully!\n")
                    setattr(page, "_turnstile_handled", True)
                    page.wait_for_timeout(600)
                    return True

                page.wait_for_timeout(1000)
        except Exception:
            pass
        return False
