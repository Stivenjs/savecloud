"""Base class and context definition for Hoster Extractors."""

import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ExtractionContext:
    """Carries execution state, captured URLs, and intermediate responses."""

    target_url: str
    expect_json: bool = False
    solve_cloudflare: bool = True
    captured_download_url: str | None = None
    captured_responses: list[Any] = field(default_factory=list)
    fetched_text: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseExtractor(ABC):
    """Abstract base class that all hoster-specific and generic extractors must implement."""

    name: str = "base"
    priority: int = 50  # Higher priority extractors are matched first
    requires_browser: bool = False  # Set to True if extractor requires headless browser (skips Tier-1 FastFetch)

    @abstractmethod
    def matches(self, url: str) -> bool:
        """Returns True if this extractor handles the given URL/domain."""
        pass

    def on_setup(self, page, context: ExtractionContext) -> None:
        """Called during page initialization (registering listeners, routes, etc.)."""
        pass

    def on_response(self, response, context: ExtractionContext) -> None:
        """Called for each network response received during navigation."""
        pass

    def on_download(self, download, context: ExtractionContext) -> None:
        """Called when a browser download event is triggered. Captures URL and cancels browser stream."""
        try:
            dl_url = getattr(download, "url", "")
            if dl_url:
                sys.stderr.write(f"[{self.name.capitalize()}] Direct download captured from event: {dl_url}\n")
                context.captured_download_url = dl_url
                if hasattr(download, "cancel"):
                    download.cancel()
        except Exception:
            pass

    def capture_direct_download_response(
        self,
        response: Any,
        context: ExtractionContext,
        exclude_patterns: tuple[str, ...] = (),
    ) -> str | None:
        """Helper to capture download URLs from HTTP response headers (Content-Disposition, proxy links)."""
        try:
            url = getattr(response, "url", "") or ""
            if not url.startswith("http"):
                return None
            for exc in exclude_patterns:
                if exc in url:
                    return None
            headers = getattr(response, "headers", {}) or {}
            cd = headers.get("content-disposition", "")
            ct = headers.get("content-type", "")
            if "attachment" in cd or "octet-stream" in ct or "dlproxy" in url:
                sys.stderr.write(f"[{self.name.capitalize()}] Direct link captured from response: {url}\n")
                context.captured_download_url = url
                return url
        except Exception:
            pass
        return None

    def page_action(self, page, context: ExtractionContext) -> str | None:
        """Performs DOM interactions (clicking download buttons, waiting, solving captcha).

        Returns direct URL if resolved, or None to let subsequent extractors/parsers handle it.
        """
        return None

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Fallback method to extract direct download link from raw response or DOM HTML."""
        return None
