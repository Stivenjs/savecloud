"""Stealth headless browser fetch strategy using Scrapling and Patchright."""

import sys

from crawler.config import BROWSER_TIMEOUT_MS
from crawler.core.browser import BrowserManager
from crawler.core.firewall import FirewallDetector
from crawler.core.network import RouteInterceptor, is_ad_domain
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.strategies.base import FetchStrategy
from crawler.utils.page_utils import extract_body


class StealthBrowserStrategy(FetchStrategy):
    """Nivel 2: Navegador headless indetectable con bypass de Cloudflare y listeners de red."""

    def execute(self, context: ExtractionContext, extractor: BaseExtractor) -> str | None:
        stealthy_fetcher = BrowserManager.get_stealthy_fetcher()
        if stealthy_fetcher is None:
            return None

        url = context.target_url

        def page_setup(page):
            # Route interception for ads and heavy assets (can be disabled by extractors)
            if getattr(extractor, "intercept_routes", True):
                RouteInterceptor.setup_routes(page, url, context.expect_json)

            def on_response(response):
                extractor.on_response(response, context)

            def on_download(download):
                extractor.on_download(download, context)

            def on_popup(popup):
                try:
                    popup.on("download", on_download)
                except Exception:
                    pass

            extractor.on_setup(page, context)

            try:
                page.on("response", on_response)
                page.on("download", on_download)
                page.on("popup", on_popup)
            except Exception:
                pass

        def page_action(page):
            action_result = extractor.page_action(page, context)
            if action_result:
                context.captured_download_url = action_result

        kwargs = {
            "headless": True,
            "network_idle": False,
            "solve_cloudflare": context.solve_cloudflare,
            "timeout": BROWSER_TIMEOUT_MS,
            "page_setup": page_setup,
            "page_action": page_action,
            "google_search": False,
            "dns_over_https": True,
            "disable_ads": True,
        }

        try:
            page = stealthy_fetcher.fetch(url, **kwargs)
        except Exception as exc:
            if BrowserManager.is_missing_browser_error(exc):
                sys.stderr.write(
                    f"[Scrapling] Browser error detected: {exc}\nDownloading Chromium...\n"
                )
                BrowserManager.ensure_browsers_installed()
                page = stealthy_fetcher.fetch(url, **kwargs)
            else:
                raise

        # 1. Check if direct download URL was captured
        if context.captured_download_url:
            return context.captured_download_url

        # 2. Check captured responses in reverse order
        for response in reversed(context.captured_responses):
            try:
                status = getattr(response, "status", None)
                if status and int(status) not in (200,):
                    continue

                body_method = getattr(response, "body", None)
                if callable(body_method):
                    try:
                        body_bytes = body_method() or b""
                        if body_bytes:
                            decoded = body_bytes.decode("utf-8", "replace")
                            valid = FirewallDetector.validate_content(
                                decoded,
                                context.expect_json,
                                ignore_turnstile=context.solve_cloudflare,
                            )
                            if valid:
                                extracted = extractor.extract_from_content(valid, context)
                                return extracted or valid
                    except Exception:
                        pass

                text_method = getattr(response, "text", None)
                if callable(text_method):
                    try:
                        body_text = text_method() or ""
                        if body_text:
                            valid = FirewallDetector.validate_content(
                                body_text,
                                context.expect_json,
                                ignore_turnstile=context.solve_cloudflare,
                            )
                            if valid:
                                extracted = extractor.extract_from_content(valid, context)
                                return extracted or valid
                    except Exception:
                        pass
            except Exception:
                pass

        # 3. Check text extracted during page_action
        if context.fetched_text:
            valid = FirewallDetector.validate_content(
                context.fetched_text,
                context.expect_json,
                ignore_turnstile=context.solve_cloudflare,
            )
            if valid:
                extracted = extractor.extract_from_content(valid, context)
                return extracted or valid

        # 4. Fallback to final page body
        body = extract_body(page)
        valid = FirewallDetector.validate_content(
            body, context.expect_json, ignore_turnstile=context.solve_cloudflare
        )
        if valid:
            extracted = extractor.extract_from_content(valid, context)
            return extracted or valid

        return None
