"""Base class and context definition for Hoster Extractors."""

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
        """Called when a browser download event is triggered."""
        pass

    def page_action(self, page, context: ExtractionContext) -> str | None:
        """Performs DOM interactions (clicking download buttons, waiting, solving captcha).

        Returns direct URL if resolved, or None to let subsequent extractors/parsers handle it.
        """
        return None

    def extract_from_content(self, content: str, context: ExtractionContext) -> str | None:
        """Fallback method to extract direct download link from raw response or DOM HTML."""
        return None
