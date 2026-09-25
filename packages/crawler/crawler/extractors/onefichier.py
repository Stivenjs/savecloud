"""Extractor for 1fichier hosting platform (1fichier.com and mirror domains)."""

import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import build_headers, extract_host, is_ignored_download_url
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.utils.dom import DomHelper


class OneFichierExtractor(BaseExtractor):
    """Handles 1fichier and mirror domains via Tier-1 FastFetch and Tier-2 StealthBrowser."""

    name: str = "onefichier"
    priority: int = 70

    DOMAINS: tuple[str, ...] = (
        "1fichier.com",
        "alterupload.com",
        "cjoint.net",
        "desfichiers.com",
        "dfichiers.com",
        "megadl.fr",
        "mesfichiers.org",
        "piecejointe.net",
        "pjointe.com",
        "tenvoi.com",
        "dl4free.com",
    )

    START_DOWNLOAD_SELECTORS: tuple[str, ...] = (
        "button:has-text('Start download')",
        "input[value='Start download']",
        "button:has-text('Free download')",
        "input[value='Free download']",
        "button:has-text('Télécharger')",
        "input[value='Télécharger']",
        "input[type='submit']",
        "button[type='submit']",
        ".btn-orange",
    )

    FINAL_DOWNLOAD_SELECTORS: tuple[str, ...] = (
        "a.ok.btn-general",
        "a:has-text('Click here to download')",
        "a:has-text('Start your download')",
        "a:has-text('Télécharger')",
        "a[href*='1fichier.com']",
    )

    RATE_LIMIT_RE = re.compile(
        r"(?:You must wait|devez attendre)\s*(\d+)\s*minute", re.IGNORECASE
    )
    DIRECT_LINK_RE = re.compile(
        r'href=["\'](https?://[a-zA-Z0-9_\-\.]*1fichier\.com/[a-zA-Z0-9_\-\.\?&=]+)["\'][^>]*>(?:Click here to download|Start your download|Télécharger|Download)',
        re.IGNORECASE,
    )
    STORAGE_URL_RE = re.compile(
        r'https?://(?:[a-zA-Z0-9_\-]+\.)?1fichier\.com/[a-zA-Z0-9_\-]+'
    )
    FILE_NAME_RE = re.compile(
        r'<span[^>]*style=["\'][^"\']*font-weight:\s*bold[^"\']*["\'][^>]*>([^<]+)</span>',
        re.IGNORECASE,
    )
    FILE_SIZE_RE = re.compile(
        r'(\d+(?:\.\d+)?\s*(?:[KMG]B|Bytes|Go|Mo|Ko))', re.IGNORECASE
    )

    EXCLUDED_RESPONSE_URLS: tuple[str, ...] = (
        "/favicon",
        "/tarifs",
        "/register",
        "/login",
        "/console",
        "/static/",
    )

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return any(d in host for d in self.DOMAINS)

    def on_response(self, response, context: ExtractionContext) -> None:
        """Intercepts direct storage response URLs and Content-Disposition headers."""
        try:
            url = getattr(response, "url", "") or ""
            if not url.startswith("http"):
                return

            for exc in self.EXCLUDED_RESPONSE_URLS:
                if exc in url:
                    return

            headers = getattr(response, "headers", {}) or {}

            # 1. Check for location header pointing to storage
            location = headers.get("location") or headers.get("Location")
            if location and self._is_direct_storage_url(location):
                sys.stderr.write(f"[1fichier] Direct link captured from Location: {location}\n")
                context.captured_download_url = location
                return

            # 2. Check if the response URL itself is a direct storage URL
            if self._is_direct_storage_url(url):
                # Ensure it's not the landing page with ?file_id
                if "?" not in url or "lg=" not in url:
                    sys.stderr.write(f"[1fichier] Direct storage URL captured: {url}\n")
                    context.captured_download_url = url
                    return

            # 3. Standard content disposition
            self.capture_direct_download_response(
                response, context, exclude_patterns=self.EXCLUDED_RESPONSE_URLS
            )

        except Exception as e:
            sys.stderr.write(f"[1fichier] on_response error: {e}\n")

    def page_action(self, page, context: ExtractionContext) -> str | None:
        """Interacts with 1fichier DOM: handles Turnstile, clicks 'Start download', then clicks final download link."""
        try:
            page.wait_for_timeout(1000)
            if context.captured_download_url:
                return context.captured_download_url

            # 1. Solve initial Turnstile if present
            TurnstileSolver.solve_if_present(page, timeout_seconds=6)
            if context.captured_download_url:
                return context.captured_download_url

            # 2. Check for rate limit / wait banner
            content = page.content()
            rl_match = self.RATE_LIMIT_RE.search(content)
            if rl_match:
                minutes = rl_match.group(1)
                sys.stderr.write(f"[1fichier] Rate limited: You must wait {minutes} minutes before next free download.\n")
                return None

            # 3. Step 1: Click "Start download" / submit button
            sys.stderr.write("[1fichier] Clicking 'Start download' button...\n")
            clicked_start = False
            for sel in self.START_DOWNLOAD_SELECTORS:
                if DomHelper.exists(page, sel):
                    if DomHelper.click(page, sel):
                        clicked_start = True
                        break

            if clicked_start:
                page.wait_for_timeout(1500)
                TurnstileSolver.solve_if_present(page, timeout_seconds=3)

            # 4. Check if final download link is already present on page
            for sel in self.FINAL_DOWNLOAD_SELECTORS:
                if DomHelper.exists(page, sel):
                    href = page.evaluate(f"() => {{ const el = document.querySelector('{sel}'); return el ? el.href : null; }}")
                    if href and href.startswith("http") and "1fichier.com" in href and "?" not in href:
                        sys.stderr.write(f"[1fichier] Found final download link: {href}\n")
                        context.captured_download_url = href
                        return href

                    # Otherwise click it to trigger download event
                    sys.stderr.write(f"[1fichier] Clicking final download link selector: {sel}\n")
                    DomHelper.click(page, sel)
                    break

            # 5. Wait for download event or network capture
            DomHelper.wait_for_capture(context, page, timeout_seconds=8)
            if context.captured_download_url:
                return context.captured_download_url

        except Exception as e:
            sys.stderr.write(f"[1fichier] page_action error: {e}\n")

        return context.captured_download_url

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Tier-1 FastFetch: checks warnings, sends POST with dl_no_ssl=on&dlinline=on, and parses final link."""
        try:
            target_url = context.target_url.split("#")[0]

            # 1. Parse metadata if available
            name_match = self.FILE_NAME_RE.search(content)
            if name_match:
                context.metadata["fileName"] = name_match.group(1).strip()
            size_match = self.FILE_SIZE_RE.search(content)
            if size_match:
                context.metadata["fileSize"] = size_match.group(1).strip()

            # 2. Check for warnings
            rl_match = self.RATE_LIMIT_RE.search(content)
            if rl_match:
                minutes = rl_match.group(1)
                sys.stderr.write(f"[1fichier] Rate limited: You must wait {minutes} minutes before next free download.\n")
                return None

            if "File not found" in content or "The requested file has been deleted" in content:
                sys.stderr.write("[1fichier] File is marked as deleted or not found.\n")
                return None

            if "reserved access to the subscribers" in content:
                sys.stderr.write("[1fichier] File requires Premium subscription.\n")
                return None

            if '<input type="password" name="pass"' in content.lower():
                sys.stderr.write("[1fichier] File is password protected.\n")
                return None

            # 3. Check if final direct link is already in page
            direct_match = self.DIRECT_LINK_RE.search(content)
            if direct_match:
                direct_url = direct_match.group(1)
                sys.stderr.write(f"[1fichier] Found direct link in content: {direct_url}\n")
                context.captured_download_url = direct_url
                return direct_url

            # 4. Perform POST request to generate download link
            sys.stderr.write(f"[1fichier] Performing POST request to generate download link: {target_url}\n")
            post_data = urllib.parse.urlencode({"dl_no_ssl": "on", "dlinline": "on"}).encode("utf-8")
            parsed = urllib.parse.urlparse(target_url)
            origin = f"{parsed.scheme}://{parsed.netloc}"

            headers = build_headers(
                referer=target_url,
                origin=origin,
                accept="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                extra={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": "LG=en",
                },
            )

            req = urllib.request.Request(target_url, data=post_data, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                resp_html = resp.read().decode("utf-8", errors="ignore")
                post_rl = self.RATE_LIMIT_RE.search(resp_html)
                if post_rl:
                    minutes = post_rl.group(1)
                    sys.stderr.write(f"[1fichier] Rate limited after POST: Wait {minutes} minutes.\n")
                    return None

                post_direct = self.DIRECT_LINK_RE.search(resp_html)
                if post_direct:
                    final_url = post_direct.group(1)
                    sys.stderr.write(f"[1fichier] Resolved direct link via FastFetch POST: {final_url}\n")
                    context.captured_download_url = final_url
                    return final_url

        except Exception as e:
            sys.stderr.write(f"[1fichier] extract_from_content error: {e}\n")

        return None

    @classmethod
    def _is_direct_storage_url(cls, url: str) -> bool:
        """Checks if a URL points directly to 1fichier storage servers (e.g. a-1.1fichier.com/c...)."""
        if not url.startswith("http"):
            return False
        if is_ignored_download_url(url):
            return False
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.lower()
        if not any(d in host for d in cls.DOMAINS):
            return False
        if host.startswith("img.") or host.startswith("static."):
            return False

        path = parsed.path
        # Storage URLs are on subdomains like a-1.1fichier.com, s-2.1fichier.com, dl-1.1fichier.com
        if re.match(r"^[asd]\d*-", host) or re.match(r"^dl\d*-", host):
            return True
        if re.match(r"^/c[0-9a-zA-Z]+$", path) and "?" not in url:
            return True

        return False
