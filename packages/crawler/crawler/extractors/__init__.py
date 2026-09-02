"""Hoster extractors plugin package."""

from crawler.extractors.base import BaseExtractor, ExtractionContext
from crawler.extractors.datanodes import DataNodesExtractor
from crawler.extractors.filekeeper import FileKeeperExtractor
from crawler.extractors.generic import GenericExtractor
from crawler.extractors.gofile import GofileExtractor
from crawler.extractors.registry import ExtractorRegistry
from crawler.extractors.rootz import RootzExtractor
from crawler.extractors.vikingfile import VikingFileExtractor

# Register built-in extractors
ExtractorRegistry.register(GenericExtractor)
ExtractorRegistry.register(VikingFileExtractor)
ExtractorRegistry.register(FileKeeperExtractor)
ExtractorRegistry.register(RootzExtractor)
ExtractorRegistry.register(DataNodesExtractor)
ExtractorRegistry.register(GofileExtractor)

__all__ = [
    "BaseExtractor",
    "ExtractionContext",
    "ExtractorRegistry",
    "GenericExtractor",
    "VikingFileExtractor",
    "FileKeeperExtractor",
    "RootzExtractor",
    "DataNodesExtractor",
    "GofileExtractor",
]
