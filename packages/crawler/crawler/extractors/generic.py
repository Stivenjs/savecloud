"""Generic fallback extractor for download buttons, links, and Turnstile challenges."""

import json
import sys

from crawler.config import (
    COMBINED_VISIBLE_SELECTORS,
    DOM_WAIT_TIMEOUT_MS,
    GENERIC_BUTTON_SELECTORS,
    GENERIC_DIRECT_LINK_SELECTORS,
    JS_STREAM_FETCH,
    SELECTOR_WAIT_TIMEOUT_MS,
)
from crawler.core.firewall import FirewallDetector, TurnstileSolver
from crawler.core.network import is_ad_domain, is_ignored_download_url
from crawler.extractors.base import BaseExtractor, ExtractionContext


class GenericExtractor(BaseExtractor):
    """Fallback extractor applicable to any standard hoster or direct file download page."""

    name: str = "generic"
    priority: int = 10  # Lowest priority so specific hosters run first

    def matches(self, url: str) -> bool:
        return True

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            response_status = getattr(response, "status", None)
            headers = getattr(response, "headers", {}) or {}

            content_disposition = headers.get("content-disposition", "")
            content_type = headers.get("content-type", "")

            # Intercept file downloads via Content-Disposition or octet-stream
            if (
                ("attachment" in content_disposition or "octet-stream" in content_type)
                and not is_ignored_download_url(response_url)
                and not is_ad_domain(response_url)
            ):
                context.captured_download_url = response_url
                return

            # Match target response
            target_url = context.target_url
            is_target = (
                response_url == target_url
                or response_url.split("?")[0] == target_url.split("?")[0]
            )
            if not is_target:
                return

            if response_status and int(response_status) not in (200, 307, 308):
                return

            context.captured_responses.append(response)
        except Exception:
            pass

    def on_download(self, download, context: ExtractionContext) -> None:
        try:
            dl_url = download.url
            if not is_ad_domain(dl_url):
                context.captured_download_url = dl_url
                try:
                    download.cancel()
                except Exception:
                    pass
        except Exception:
            pass

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=DOM_WAIT_TIMEOUT_MS)
        except Exception:
            pass

        # If JSON is expected, look for <pre> or JSON body
        if context.expect_json:
            try:
                raw_json = page.evaluate("""() => {
                    const pre = document.querySelector('pre');
                    if (pre && pre.innerText) {
                        const t = pre.innerText.trim();
                        if (t.startsWith('{') || t.startsWith('[')) return t;
                    }
                    if (document.body && document.body.innerText) {
                        const t = document.body.innerText.trim();
                        if (t.startsWith('{') || t.startsWith('[')) return t;
                    }
                    return null;
                }""")
                if raw_json and isinstance(raw_json, str) and raw_json.strip():
                    context.fetched_text = raw_json
                    return raw_json
            except Exception as e:
                sys.stderr.write(f"[page_action] Error extracting JSON from DOM: {e}\n")

            try:
                fetched = page.evaluate(JS_STREAM_FETCH, context.target_url)
                if isinstance(fetched, str) and fetched.strip():
                    context.fetched_text = fetched
                    return fetched
            except Exception:
                pass
            return None

        # Solve Cloudflare Turnstile if present
        TurnstileSolver.solve(page)

        # Try JS stream fetch
        try:
            fetched = page.evaluate(JS_STREAM_FETCH, context.target_url)
            if isinstance(fetched, str) and fetched.strip():
                context.fetched_text = fetched
        except Exception:
            pass

        # Scan for direct download links in href
        try:
            for sel in GENERIC_DIRECT_LINK_SELECTORS:
                locator = page.locator(sel)
                count = locator.count()
                for i in range(count):
                    el = locator.nth(i)
                    if el.is_visible():
                        href = el.get_attribute("href")
                        if href:
                            href_str = str(href).strip()
                            if (
                                href_str
                                and not href_str.startswith("#")
                                and not href_str.startswith("javascript:")
                            ):
                                absolute_url = page.evaluate(
                                    "href => new URL(href, window.location.href).href",
                                    href_str,
                                )
                                if (
                                    "/download/" in absolute_url
                                    or "download" in absolute_url.lower()
                                ):
                                    sys.stderr.write(
                                        f"Direct link found in href of '{sel}': {absolute_url}\n"
                                    )
                                    context.captured_download_url = absolute_url
                                    return absolute_url
        except Exception:
            pass

        # Wait for common download buttons to render
        try:
            page.wait_for_selector(
                COMBINED_VISIBLE_SELECTORS,
                state="visible",
                timeout=SELECTOR_WAIT_TIMEOUT_MS,
            )
        except Exception:
            pass

        if context.captured_download_url:
            return context.captured_download_url

        # Attempt to click visible download buttons
        try:
            for selector in GENERIC_BUTTON_SELECTORS:
                try:
                    elements = page.locator(selector)
                    count = elements.count()
                    for i in range(count):
                        el = elements.nth(i)
                        if el.is_visible():
                            try:
                                el.click(timeout=2000, force=True)
                                page.wait_for_timeout(300)
                                TurnstileSolver.solve(page)
                            except Exception:
                                pass

                            if context.captured_download_url:
                                return context.captured_download_url
                except Exception:
                    pass
        except Exception:
            pass

        return context.captured_download_url

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        return FirewallDetector.validate_content(
            content, context.expect_json, ignore_turnstile=context.solve_cloudflare
        )
