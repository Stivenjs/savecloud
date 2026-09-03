"""Detection of anti-bot firewalls (Cloudflare, AWS WAF) and Turnstile solver."""

import json
import sys

from crawler.config import FIREWALL_KEYWORDS
from crawler.core.reporter import CrawlerReporter
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
    def solve(page) -> bool:
        try:
            target_selectors = [
                "a#download-link",
                "#download-btn",
                ".download-button",
                "a.download-btn",
            ]
            for sel in target_selectors:
                try:
                    if (
                        page.locator(sel).count() > 0
                        and page.locator(sel).first.is_visible()
                    ):
                        return True
                except Exception:
                    pass

            cf_frame = None
            for frame in page.frames:
                if "challenges.cloudflare.com" in frame.url:
                    cf_frame = frame
                    break

            if cf_frame:
                CrawlerReporter.report("turnstile", "Found Cloudflare Turnstile, solving challenge...")
                sys.stderr.write(
                    "Found embedded Cloudflare Turnstile iframe, attempting to solve...\n"
                )
                try:
                    page.evaluate(
                        'document.querySelectorAll(\'#dontfoid, div[id^="dontfo"]\')'
                        ".forEach(el => el.remove())"
                    )
                except Exception:
                    pass

                try:
                    checkbox = cf_frame.locator(".tIReV4 input").first
                    if checkbox.count() > 0 and checkbox.is_visible():
                        checkbox.hover(timeout=2000)
                        page.wait_for_timeout(200)
                        checkbox.click(timeout=3000)
                        page.wait_for_timeout(2000)
                        return True
                except Exception:
                    pass

                try:
                    iframe_locator = page.locator(
                        "iframe[src*='challenges.cloudflare.com']:visible"
                    ).first
                    if iframe_locator.count() > 0:
                        iframe_locator.click(
                            position={"x": 180, "y": 32}, timeout=2000
                        )
                        page.wait_for_timeout(2000)
                        return True
                except Exception:
                    pass
        except Exception as e:
            sys.stderr.write(f"Error in solve_embedded_turnstile: {e}\n")
        return False

    @classmethod
    def solve_if_present(cls, page, timeout_seconds: int = 10) -> bool:
        """Quickly detects if Turnstile is present and attempts to solve it."""
        try:
            for sec in range(timeout_seconds):
                has_turnstile = page.evaluate("""() => {
                    const hasIframe = Array.from(document.querySelectorAll('iframe')).some(
                        f => (f.src || '').includes('challenges.cloudflare.com')
                    );
                    const hasInput = !!document.querySelector('input[name="cf-turnstile-response"]');
                    return hasIframe || hasInput;
                }""")
                if not has_turnstile and sec >= 2:
                    return False

                cls.solve(page)
                has_token = page.evaluate(
                    "() => document.querySelector('input[name=\"cf-turnstile-response\"]')?.value?.length > 20"
                )
                if has_token:
                    CrawlerReporter.report("turnstile_solved", "Cloudflare Turnstile verified successfully")
                    sys.stderr.write("[Turnstile] Verified successfully!\n")
                    return True
                page.wait_for_timeout(1000)
        except Exception:
            pass
        return False
