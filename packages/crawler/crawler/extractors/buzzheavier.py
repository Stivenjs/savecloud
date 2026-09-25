"""Extractor for Buzzheavier hosting platform (buzzheavier.com, bzzhr.co, etc.)."""

import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import build_headers, extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class BuzzheavierExtractor(BaseExtractor):
    """Handles Buzzheavier and related mirror domains via Tier-1 FastFetch and Tier-2 StealthBrowser."""

    name: str = "buzzheavier"
    priority: int = 80

    DOMAINS: tuple[str, ...] = (
        "buzzheavier.com",
        "bzzhr.co",
        "bzzhr.to",
        "fuckingfast.net",
        "dd.buzzheavier.com",
    )

    DOWNLOAD_BUTTON_SELECTORS: tuple[str, ...] = (
        ".download-btn",
        "button[hx-get]",
        "a[hx-get]",
        "#download-btn",
        "button:has-text('Download')",
        "a:has-text('Download')",
        "button:has-text('Descargar')",
    )

    HX_GET_RE = re.compile(r'hx-get="([^"]+)"')
    FILE_NAME_RE = re.compile(r'class="[^"]*file-name[^"]*"[^>]*>([^<]+)<')

    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = (
        "/xz.js",
        "/favicon",
        "/static/",
    )

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_response(self, response, context: ExtractionContext) -> None:
        """Intercepts network responses for hx-redirect, Location headers, and /dl/ paths."""
        try:
            url = getattr(response, "url", "") or ""
            if not url.startswith("http"):
                return

            for exc in self.EXCLUDED_RESPONSE_URLS:
                if exc in url:
                    return

            headers = getattr(response, "headers", {}) or {}

            # 1. Check for HTMX redirect header (hx-redirect)
            hx_redirect = headers.get("hx-redirect") or headers.get("HX-Redirect")
            if hx_redirect:
                resolved = self._normalize_redirect_url(url, hx_redirect)
                sys.stderr.write(f"[Buzzheavier] Direct link captured from hx-redirect: {resolved}\n")
                context.captured_download_url = resolved
                return

            # 2. Check for standard 302/307 Location redirect header
            location = headers.get("location") or headers.get("Location")
            if location:
                resolved = self._normalize_redirect_url(url, location)
                if resolved.rstrip("/") != url.rstrip("/") and ("/dl/" in resolved or "download" in url or "/files/" in resolved):
                    sys.stderr.write(f"[Buzzheavier] Direct link captured from Location: {resolved}\n")
                    context.captured_download_url = resolved
                    return

            # 3. Direct download via /dl/ path
            if "/dl/" in url:
                sys.stderr.write(f"[Buzzheavier] Direct link captured from URL: {url}\n")
                context.captured_download_url = url
                return

            # 4. Standard content-disposition
            self.capture_direct_download_response(
                response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
            )

        except Exception as e:
            sys.stderr.write(f"[Buzzheavier] on_response error: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> str | None:
        """Interacts with the Buzzheavier DOM: solves Turnstile, clicks download button, or evaluates HTMX request."""
        try:
            page.wait_for_timeout(1000)
            if context.captured_download_url:
                return context.captured_download_url

            # 1. Solve initial Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=6)
            if context.captured_download_url:
                return context.captured_download_url

            # 2. Click download button
            sys.stderr.write("[Buzzheavier] Clicking download button...\n")
            clicked = False
            for sel in self.DOWNLOAD_BUTTON_SELECTORS:
                if DomHelper.exists(page, sel):
                    if DomHelper.click(page, sel):
                        clicked = True
                        break

            if not clicked:
                DomHelper.click_button_with_text(page, patterns=("download", "descargar"))

            page.wait_for_timeout(800)
            TurnstileSolver.solve_if_present(page, timeout_seconds=3)

            # 3. Wait for download event or network capture
            DomHelper.wait_for_capture(context, page, timeout_seconds=8)
            if context.captured_download_url:
                return context.captured_download_url

            # 4. Fallback: Evaluate HTMX HEAD / GET request within page context
            sys.stderr.write("[Buzzheavier] Attempting page evaluation fallback for HTMX download...\n")
            direct = page.evaluate(
                """async () => {
                    try {
                        const btn = document.querySelector('.download-btn, [hx-get]');
                        let dlUrl = btn ? btn.getAttribute('hx-get') : null;
                        if (!dlUrl) {
                            dlUrl = window.location.pathname.replace(/\\/$/, '') + '/download';
                        }
                        const resp = await fetch(dlUrl, {
                            method: 'HEAD',
                            headers: {
                                'hx-request': 'true',
                                'hx-current-url': window.location.href,
                            },
                        });
                        const hxRedir = resp.headers.get('hx-redirect');
                        if (hxRedir) {
                            return hxRedir.startsWith('/') ? (window.location.origin + hxRedir) : hxRedir;
                        }
                        return null;
                    } catch(e) {
                        return null;
                    }
                }"""
            )
            if direct:
                sys.stderr.write(f"[Buzzheavier] Captured direct link from page evaluation: {direct}\n")
                context.captured_download_url = direct
                return direct

        except Exception as e:
            sys.stderr.write(f"[Buzzheavier] page_action error: {e}\n")

        return context.captured_download_url

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Tier-1 FastFetch: finds hx-get attribute in HTML and requests hx-redirect directly."""
        try:
            target_url = context.target_url.split("#")[0].rstrip("/")

            # Extract hx-get attribute or default to /download
            match = self.HX_GET_RE.search(content)
            if match:
                hx_path = match.group(1)
                dl_url = urllib.parse.urljoin(target_url, hx_path)
            else:
                dl_url = f"{target_url}/download"

            sys.stderr.write(f"[Buzzheavier] Querying HTMX endpoint: {dl_url}\n")
            headers = build_headers(referer=target_url, htmx=True)

            direct_url = self._resolve_htmx_redirect(dl_url, headers)
            if direct_url:
                sys.stderr.write(f"[Buzzheavier] Resolved direct link via FastFetch: {direct_url}\n")
                context.captured_download_url = direct_url
                return direct_url

        except Exception as e:
            sys.stderr.write(f"[Buzzheavier] extract_from_content error: {e}\n")

        return None

    @classmethod
    def _normalize_redirect_url(cls, base_url: str, redirect_val: str) -> str:
        if redirect_val.startswith("http://") or redirect_val.startswith("https://"):
            return redirect_val
        return urllib.parse.urljoin(base_url, redirect_val)

    @classmethod
    def _resolve_htmx_redirect(cls, url: str, headers: dict[str, str], timeout: int = 10) -> str | None:
        """Helper to send HTMX request and parse hx-redirect or Location header."""
        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def http_error_302(self, req, fp, code, msg, hdrs):
                return fp
            http_error_301 = http_error_302
            http_error_303 = http_error_302
            http_error_307 = http_error_302
            http_error_308 = http_error_302

        try:
            opener = urllib.request.build_opener(NoRedirectHandler)
            req = urllib.request.Request(url, headers=headers)
            with opener.open(req, timeout=timeout) as resp:
                hx_redir = resp.headers.get("hx-redirect") or resp.headers.get("HX-Redirect")
                if hx_redir:
                    return cls._normalize_redirect_url(url, hx_redir)
                loc = resp.headers.get("location") or resp.headers.get("Location")
                if loc:
                    return cls._normalize_redirect_url(url, loc)
                resp_url = getattr(resp, "url", "")
                if "/dl/" in resp_url:
                    return resp_url
        except urllib.error.HTTPError as e:
            hx_redir = e.headers.get("hx-redirect") or e.headers.get("HX-Redirect")
            if hx_redir:
                return cls._normalize_redirect_url(url, hx_redir)
            loc = e.headers.get("location") or e.headers.get("Location")
            if loc:
                return cls._normalize_redirect_url(url, loc)
        except Exception as e:
            sys.stderr.write(f"[Buzzheavier] HTMX request failed: {e}\n")

        return None
