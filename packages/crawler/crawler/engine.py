"""Crawler engine that orchestrates strategies and extractors."""

import sys

from crawler.core.browser import BrowserManager
from crawler.core.network import is_json_url
from crawler.extractors.base import ExtractionContext
from crawler.extractors.registry import ExtractorRegistry
from crawler.strategies.fast_fetch import FastFetchStrategy
from crawler.strategies.stealth_browser import StealthBrowserStrategy


class CrawlerEngine:
    """High-level crawler engine that resolves URLs using strategies and hoster extractors."""

    def __init__(self):
        self.fast_strategy = FastFetchStrategy()
        self.stealth_strategy = StealthBrowserStrategy()

    def fetch(self, url: str) -> str:
        """Fetches the target URL, returning the resolved direct URL or valid content.

        Raises RuntimeError if fetch fails or is blocked.
        """
        expect_json = is_json_url(url)
        extractor = ExtractorRegistry.resolve(url)
        context = ExtractionContext(target_url=url, expect_json=expect_json)

        # 1. Tier-1 Fast Fetch (curl_cffi TLS impersonation)
        if not getattr(extractor, "requires_browser", False):
            fast_result = self.fast_strategy.execute(context, extractor)
            if fast_result:
                return fast_result

        # 2. Tier-2 Stealth Headless Browser
        errors: list[str] = []
        try:
            browser_result = self.stealth_strategy.execute(context, extractor)
            if browser_result:
                return browser_result
        except Exception as e:
            sys.stderr.write(f"Stealth browser attempt failed: {e}\n")
            errors.append(f"Stealth browser: {e}")

            # If browser binaries were missing, install and retry once
            if BrowserManager.is_missing_browser_error(e):
                BrowserManager.ensure_browsers_installed()
                retry_result = self.stealth_strategy.execute(context, extractor)
                if retry_result:
                    return retry_result

        err_details = " | ".join(errors) if errors else "Respuesta vacía o bloqueada"
        raise RuntimeError(f"No se pudo obtener contenido válido de {url}: {err_details}")
