"""Fast Tier-1 fetch strategy using curl_cffi with TLS impersonation (~100-200ms)."""

import sys

from crawler.config import DEFAULT_HEADERS, FAST_FETCH_TIMEOUT_SECONDS
from crawler.core.browser import BrowserManager
from crawler.core.firewall import FirewallDetector
from crawler.core.network import smart_referer
from crawler.core.reporter import CrawlerReporter
from crawler.core.session import SessionManager
from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.strategies.base import FetchStrategy
from crawler.utils.page_utils import extract_body


class FastFetchStrategy(FetchStrategy):
    """Level 1 Fast: Direct HTTP request with TLS impersonation and session reuse."""

    def execute(self, context: ExtractionContext, extractor: BaseExtractor) -> str | None:
        try:
            CrawlerReporter.report("fast_fetch", "Checking fast connection...")
            fetcher = BrowserManager.get_fetcher()
            if fetcher is None:
                return None

            url = context.target_url
            headers = dict(DEFAULT_HEADERS)
            headers["Referer"] = smart_referer(url)

            # Check if there is an active clearance session (cf_clearance, cookies, user-agent)
            session = SessionManager.get_session(url)
            session_cookies = None
            if session:
                session_cookies = session.get("cookies", {})
                ua = session.get("user_agent")
                if ua:
                    headers["User-Agent"] = ua
                if session_cookies:
                    headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in session_cookies.items())

            kwargs: dict = {
                "headers": headers,
                "timeout": FAST_FETCH_TIMEOUT_SECONDS,
                "follow_redirects": True,
            }
            if session_cookies:
                kwargs["cookies"] = session_cookies

            res = fetcher.get(url, **kwargs)
            body = extract_body(res)
            valid = FirewallDetector.validate_content(body, context.expect_json)
            if valid:
                if session:
                    sys.stderr.write(f"[FastFetch] Reused clearance session for {url}\n")
                # Give the extractor a chance to parse direct links if applicable
                extracted = extractor.extract_from_content(valid, context)
                if extracted:
                    return extracted
                if extractor.name == "generic":
                    return valid
                return None

            # If clearance session was used but rejected, invalidate it for a fresh solve
            if session:
                sys.stderr.write(f"[FastFetch] Clearance session expired for {url}. Invalidating.\n")
                SessionManager.invalidate(url)
        except Exception as e:
            sys.stderr.write(f"[FastFetch] curl_cffi attempt failed: {e}\n")

        return None
