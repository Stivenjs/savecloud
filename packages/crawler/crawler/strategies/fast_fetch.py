"""Fast Tier-1 fetch strategy using curl_cffi with TLS impersonation (~100-200ms)."""

import sys

from crawler.config import DEFAULT_HEADERS, FAST_FETCH_TIMEOUT_SECONDS
from crawler.core.browser import BrowserManager
from crawler.core.firewall import FirewallDetector
from crawler.core.network import smart_referer
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.strategies.base import FetchStrategy
from crawler.utils.page_utils import extract_body


class FastFetchStrategy(FetchStrategy):
    """Nivel 1 Rápido: Petición HTTP directa con TLS impersonation."""

    def execute(self, context: ExtractionContext, extractor: BaseExtractor) -> str | None:
        try:
            fetcher = BrowserManager.get_fetcher()
            if fetcher is None:
                return None

            url = context.target_url
            headers = dict(DEFAULT_HEADERS)
            headers["Referer"] = smart_referer(url)

            res = fetcher.get(
                url,
                headers=headers,
                timeout=FAST_FETCH_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
            body = extract_body(res)
            valid = FirewallDetector.validate_content(body, context.expect_json)
            if valid:
                # Give the extractor a chance to parse direct links if applicable
                extracted = extractor.extract_from_content(valid, context)
                if extracted:
                    return extracted
                if extractor.name == "generic":
                    return valid
                return None
        except Exception as e:
            sys.stderr.write(f"[FastFetch] curl_cffi attempt failed: {e}\n")

        return None
