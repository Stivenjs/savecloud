"""Registry and resolver for hoster extractors."""

from typing import Type

from crawler.extractors.base import BaseExtractor


class ExtractorRegistry:
    """Manages registered hoster extractors and resolves appropriate extractor by URL."""

    _extractors: list[Type[BaseExtractor]] = []

    @classmethod
    def register(cls, extractor_cls: Type[BaseExtractor]) -> Type[BaseExtractor]:
        """Registers an extractor class. Can be used as a decorator."""
        if extractor_cls not in cls._extractors:
            cls._extractors.append(extractor_cls)
            # Keep sorted by priority descending
            cls._extractors.sort(key=lambda ext: getattr(ext, "priority", 50), reverse=True)
        return extractor_cls

    @classmethod
    def get_all(cls) -> list[Type[BaseExtractor]]:
        return list(cls._extractors)

    @classmethod
    def resolve(cls, url: str) -> BaseExtractor:
        """Finds the highest priority extractor matching the target URL."""
        for ext_cls in cls._extractors:
            extractor = ext_cls()
            if extractor.matches(url):
                return extractor

        # Fallback to GenericExtractor if registered
        from crawler.extractors.generic import GenericExtractor
        return GenericExtractor()

    @classmethod
    def clear(cls) -> None:
        """Clears registered extractors (primarily for testing)."""
        cls._extractors.clear()
