"""Base strategy interface for fetching and crawling pages."""

from abc import ABC, abstractmethod

from crawler.extractors.base import BaseExtractor, ExtractionContext


class FetchStrategy(ABC):
    """Abstract strategy for executing network or browser fetch."""

    @abstractmethod
    def execute(self, context: ExtractionContext, extractor: BaseExtractor) -> str | None:
        """Executes the fetch strategy and returns the extracted content or direct URL."""
        pass
