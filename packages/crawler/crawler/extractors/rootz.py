"""Extractor for Rootz hosting platform (rootz.so)."""

import json
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


class RootzExtractor(BaseExtractor):
    """Handles Rootz (rootz.so) links via Tier-1 FastFetch (SSR token + API) and Tier-2 StealthBrowser."""

    name: str = "rootz"
    priority: int = 80

    DOMAINS: tuple[str, ...] = ("rootz.so", "www.rootz.so")
    API_ORIGIN: str = "https://rootz.so"
    CDN_INDICATORS: tuple[str, ...] = ("cloudflarestorage.com", "alcyone.so")

    # Next.js RSC / SSR regex for pageToken
    PAGE_TOKEN_RE = re.compile(r'pageToken\\?":\\?"([^\\"]+)')

    # Step 1: Funnel UI (Free vs Fast tab)
    FREE_TAB_SELECTORS: tuple[str, ...] = (
        'div[role="radio"]:has-text("Free")',
        '[aria-label="Choose your download"] div:has-text("Free")',
        'div[role="radio"][aria-checked="false"]',
    )
    FREE_TAB_TEXT_PATTERNS: tuple[str, ...] = ("Free", "Slow download")

    # Step 2: Download button selectors
    DOWNLOAD_BUTTON_SELECTORS: tuple[str, ...] = (
        "#fb656a3bc",
        "#download-button-container button",
        "button:has-text('Slow download')",
        "button:has-text('Download')",
        "button:has-text('Descargar')",
    )

    # Indicator for countdown or preparation
    PREPARING_INDICATORS: tuple[str, ...] = (
        "Preparing",
        "Wait",
        "Cooldown",
    )

    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = (
        "rootz.so/_next",
        "rootz.so/images",
        "rootz.so/api/auth",
    )

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    @classmethod
    def extract_short_id(cls, url: str) -> str | None:
        """Extracts shortId or fileId from Rootz URL (/d/<id> or /file/<id>)."""
        try:
            parsed = urllib.parse.urlparse(url)
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("d", "file"):
                return parts[1]
            if len(parts) == 1:
                return parts[0]
        except Exception:
            pass
        return None

    @classmethod
    def extract_page_token(cls, html: str) -> str | None:
        """Extracts pageToken from Next.js SSR / RSC html chunks."""
        match = cls.PAGE_TOKEN_RE.search(html)
        if match:
            return match.group(1)
        return None

    def on_response(self, response, context: ExtractionContext) -> None:
        """Intercepts network responses for proxy-download redirects, CDN links, and API metadata."""
        try:
            url = getattr(response, "url", "") or ""
            if not url.startswith("http"):
                return

            for exc in self.EXCLUDED_RESPONSE_URLS:
                if exc in url:
                    return

            # 1. Check direct download or CDN signed storage URL
            if any(cdn in url.lower() for cdn in self.CDN_INDICATORS):
                sys.stderr.write(f"[Rootz] Direct CDN link captured from response: {url}\n")
                context.captured_download_url = url
                return

            # 2. Check for redirect response from proxy-download
            headers = getattr(response, "headers", {}) or {}
            if "proxy-download" in url:
                loc = headers.get("location") or headers.get("Location")
                if loc:
                    resolved_url = urllib.parse.urljoin(url, loc)
                    sys.stderr.write(f"[Rootz] Direct link captured from proxy-download Location: {resolved_url}\n")
                    context.captured_download_url = resolved_url
                    return

            # 3. Check for Content-Disposition or octet-stream
            self.capture_direct_download_response(
                response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
            )

            # 4. Check for metadata API response
            if "api/files/download" in url:
                try:
                    text_method = getattr(response, "text", None)
                    if callable(text_method):
                        data_text = text_method()
                        if data_text:
                            data = json.loads(data_text)
                            if isinstance(data, dict) and data.get("success"):
                                meta = data.get("data") or {}
                                if isinstance(meta, dict):
                                    context.metadata.update(meta)
                                    direct_url = meta.get("url")
                                    if direct_url and direct_url.startswith("http"):
                                        context.captured_download_url = direct_url
                except Exception:
                    pass

        except Exception as e:
            sys.stderr.write(f"[Rootz] on_response error: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> str | None:
        """Interacts with the Rootz DOM: solves Turnstile, switches to Free tab, waits for timer, and clicks download."""
        try:
            page.wait_for_timeout(1000)
            if context.captured_download_url:
                return context.captured_download_url

            # 1. Solve initial Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=6)
            if context.captured_download_url:
                return context.captured_download_url

            # 2. Switch from Premium to Free tab in funnel layout if present
            if DomHelper.has_text(page, "Choose your download") or DomHelper.exists(page, 'div[role="radio"]'):
                sys.stderr.write("[Rootz] Funnel layout detected. Selecting 'Free' option...\n")
                clicked_tab = False
                for sel in self.FREE_TAB_SELECTORS:
                    if DomHelper.exists(page, sel):
                        if DomHelper.click(page, sel):
                            clicked_tab = True
                            break
                if not clicked_tab:
                    DomHelper.click_button_with_text(page, patterns=("free",))
                page.wait_for_timeout(500)

            # 3. Check if download button is in 'Preparing...' / countdown state
            btn_selector = "#fb656a3bc"
            if DomHelper.exists(page, btn_selector):
                if not DomHelper.is_enabled(page, btn_selector) or DomHelper.has_text(page, self.PREPARING_INDICATORS):
                    sys.stderr.write("[Rootz] Waiting for preparation countdown...\n")
                    DomHelper.wait_until_enabled(page, btn_selector, timeout_seconds=15)

            # 4. Click Rootz download button
            sys.stderr.write("[Rootz] Clicking download button...\n")
            clicked = False
            for sel in self.DOWNLOAD_BUTTON_SELECTORS:
                if DomHelper.exists(page, sel):
                    if DomHelper.click(page, sel):
                        clicked = True
                        break

            if not clicked:
                DomHelper.click_button_with_text(page, patterns=("slow download", "download", "descargar"))

            page.wait_for_timeout(800)
            TurnstileSolver.solve_if_present(page, timeout_seconds=3)

            # 5. Wait for download event or network capture
            DomHelper.wait_for_capture(context, page, timeout_seconds=8)

            # 6. Fallback: Trigger proxy-download directly from page if we know the short_id / file_id
            if not context.captured_download_url:
                short_id = self.extract_short_id(context.target_url)
                file_id = context.metadata.get("fileId") or short_id
                if file_id:
                    sys.stderr.write(f"[Rootz] Attempting page evaluation fallback for proxy-download: {file_id}\n")
                    loc = page.evaluate(
                        """async (id) => {
                            try {
                                const resp = await fetch('/api/files/proxy-download/' + id, { method: 'HEAD', redirect: 'follow' });
                                return resp.url;
                            } catch(e) {
                                return null;
                            }
                        }""",
                        file_id,
                    )
                    if loc and any(cdn in loc for cdn in self.CDN_INDICATORS):
                        context.captured_download_url = loc
                        return loc

        except Exception as e:
            sys.stderr.write(f"[Rootz] page_action error: {e}\n")

        return context.captured_download_url

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Tier-1 FastFetch: extracts pageToken from SSR HTML, queries metadata API and proxy-download."""
        try:
            short_id = self.extract_short_id(context.target_url)
            if not short_id:
                return None

            page_token = self.extract_page_token(content)
            if not page_token:
                sys.stderr.write("[Rootz] No pageToken found in content (FastFetch fallback to browser)\n")
                return None

            sys.stderr.write(f"[Rootz] Found pageToken for shortId={short_id}. Querying API...\n")

            # 1. Query metadata API: /api/files/download-by-short/{short_id}
            api_url = f"{self.API_ORIGIN}/api/files/download-by-short/{short_id}"
            req_headers = build_headers(
                referer=f"{self.API_ORIGIN}/d/{short_id}",
                origin=self.API_ORIGIN,
                accept="application/json",
                extra={"X-Page-Token": page_token},
            )

            meta_data = self._http_get_json(api_url, req_headers)
            if meta_data:
                context.metadata.update(meta_data)
                status = meta_data.get("status")
                if status == "deleted":
                    sys.stderr.write(f"[Rootz] File is marked as deleted: {meta_data.get('fileName', short_id)}\n")
                    return None

                if meta_data.get("passwordProtected"):
                    sys.stderr.write("[Rootz] File is password protected\n")
                    return None

                if meta_data.get("downloadAllowed") is False:
                    sys.stderr.write("[Rootz] Download not allowed by hoster\n")
                    return None

                # Direct url in metadata
                direct_url = meta_data.get("url")
                if direct_url and direct_url.startswith("http"):
                    context.captured_download_url = direct_url
                    return direct_url

                file_id = meta_data.get("fileId") or short_id
            else:
                file_id = short_id

            # 2. Resolve proxy-download redirect
            proxy_url = f"{self.API_ORIGIN}/api/files/proxy-download/{file_id}"
            cdn_url = self._resolve_proxy_redirect(proxy_url, req_headers)
            if cdn_url:
                sys.stderr.write(f"[Rootz] Resolved CDN link via FastFetch: {cdn_url}\n")
                context.captured_download_url = cdn_url
                return cdn_url

        except Exception as e:
            sys.stderr.write(f"[Rootz] extract_from_content error: {e}\n")

        return None

    @classmethod
    def _http_get_json(cls, url: str, headers: dict[str, str], timeout: int = 10) -> dict[str, Any] | None:
        """Helper to make HTTP GET request and parse JSON response."""
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    if isinstance(data, dict) and data.get("success"):
                        return data.get("data") or {}
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"[Rootz] API HTTP error {e.code}: {e.reason}\n")
        except Exception as e:
            sys.stderr.write(f"[Rootz] API request failed: {e}\n")
        return None

    @classmethod
    def _resolve_proxy_redirect(cls, proxy_url: str, headers: dict[str, str], timeout: int = 10) -> str | None:
        """Helper to resolve proxy-download redirect without downloading full payload."""
        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def http_error_302(self, req, fp, code, msg, hdrs):
                return fp
            http_error_301 = http_error_302
            http_error_303 = http_error_302
            http_error_307 = http_error_302
            http_error_308 = http_error_302

        try:
            opener = urllib.request.build_opener(NoRedirectHandler)
            req = urllib.request.Request(proxy_url, headers=headers)
            with opener.open(req, timeout=timeout) as resp:
                resp_headers = resp.headers
                loc = resp_headers.get("location") or resp_headers.get("Location")
                if loc:
                    resolved = urllib.parse.urljoin(proxy_url, loc)
                    return resolved
                resp_url = getattr(resp, "url", "")
                if any(cdn in resp_url for cdn in cls.CDN_INDICATORS):
                    return resp_url
        except urllib.error.HTTPError as e:
            loc = e.headers.get("location") or e.headers.get("Location")
            if loc:
                return urllib.parse.urljoin(proxy_url, loc)
        except Exception as e:
            sys.stderr.write(f"[Rootz] proxy redirect check failed: {e}\n")
        return None

