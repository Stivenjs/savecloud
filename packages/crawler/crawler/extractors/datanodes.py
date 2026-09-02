"""Extractor for DataNodes hosting platform (datanodes.to)."""

import sys

from crawler.core.firewall import TurnstileSolver
from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class DataNodesExtractor(BaseExtractor):
    """Handles DataNodes (datanodes.to) links, Cloudflare Turnstile, and 10s countdown."""

    name: str = "datanodes"
    priority: int = 85
    requires_browser: bool = True  # Full headless browser required for Turnstile & countdown

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return "datanodes.to" in host or "datanodes" in host

    def on_download(self, download, context: ExtractionContext) -> None:
        try:
            dl_url = download.url
            sys.stderr.write(f"[DataNodes] Direct download captured from event: {dl_url}\n")
            context.captured_download_url = dl_url
            download.cancel()
        except Exception:
            pass

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            url = getattr(response, "url", "") or ""
            headers = getattr(response, "headers", {}) or {}
            cd = headers.get("content-disposition", "")
            ct = headers.get("content-type", "")

            # If response is a direct download or proxy link
            if ("attachment" in cd or "octet-stream" in ct or "dlproxy" in url) and url.startswith("http"):
                if "datanodes.to/theme" not in url:
                    sys.stderr.write(f"[DataNodes] Direct link captured from response: {url}\n")
                    context.captured_download_url = url
        except Exception:
            pass

    def page_action(self, page, context: ExtractionContext) -> str | None:
        try:
            page.wait_for_timeout(2000)

            # 1. Solve Cloudflare Turnstile Captcha
            sys.stderr.write("[DataNodes] Checking and solving Turnstile captcha...\n")
            for _ in range(20):
                TurnstileSolver.solve(page)
                has_token = page.evaluate(
                    "() => document.querySelector('input[name=\"cf-turnstile-response\"]')?.value?.length > 20"
                )
                if has_token:
                    sys.stderr.write("[DataNodes] Turnstile verified successfully!\n")
                    break
                page.wait_for_timeout(1000)

            page.wait_for_timeout(1000)

            # 2. Click Free Download button to initiate countdown
            sys.stderr.write("[DataNodes] Clicking 'Free Download' button...\n")
            clicked = page.evaluate("""() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Free Download'));
                if (btn) {
                    btn.scrollIntoView();
                    btn.click();
                    return true;
                }
                return false;
            }""")
            if not clicked:
                try:
                    btn = page.locator("button:has-text('Free Download')").first
                    if btn.is_visible():
                        btn.click(force=True)
                except Exception:
                    pass

            # 3. Wait for 10s countdown to complete
            sys.stderr.write("[DataNodes] Waiting for 10-second countdown...\n")
            for sec in range(16):
                page.wait_for_timeout(1000)
                if context.captured_download_url:
                    return context.captured_download_url

                # Check if countdown finished and 'Start Download' / 'Download' appeared
                button_state = page.evaluate("""() => {
                    const buttons = Array.from(document.querySelectorAll('button, a.btn')).map(b => b.innerText.replace(/\\n/g, ' '));
                    return buttons;
                }""")

                for text in button_state:
                    t_lower = text.lower().strip()
                    if "start download" in t_lower or t_lower == "download":
                        sys.stderr.write(
                            f"[DataNodes] Countdown finished at {sec+1}s! Triggering final download...\n"
                        )
                        page.evaluate("""() => {
                            const b = Array.from(document.querySelectorAll('button, a')).find(el => {
                                const t = el.innerText.trim().toLowerCase();
                                return t.includes('start download') || t === 'download';
                            });
                            if (b) b.click();
                        }""")
                        break

            # 4. Wait a few seconds for download event or proxy redirect
            for _ in range(6):
                if context.captured_download_url:
                    return context.captured_download_url
                page.wait_for_timeout(1000)

        except Exception as e:
            sys.stderr.write(f"[DataNodes] Error in page_action: {e}\n")

        return context.captured_download_url
