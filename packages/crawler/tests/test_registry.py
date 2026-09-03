"""Unit tests for the ExtractorRegistry."""

import unittest

# Import extractors package so built-ins register
import crawler.extractors  # noqa: F401
from crawler.extractors.filekeeper import FileKeeperExtractor
from crawler.extractors.generic import GenericExtractor
from crawler.extractors.registry import ExtractorRegistry
from crawler.extractors.rootz import RootzExtractor
from crawler.extractors.vikingfile import VikingFileExtractor


class TestExtractorRegistry(unittest.TestCase):
    def test_vikingfile_resolved(self):
        ext = ExtractorRegistry.resolve("https://vikingfile.com/f/xyz123")
        self.assertIsInstance(ext, VikingFileExtractor)

    def test_filekeeper_resolved(self):
        ext = ExtractorRegistry.resolve("https://filekeeper.net/d/test")
        self.assertIsInstance(ext, FileKeeperExtractor)

    def test_rootz_resolved(self):
        ext = ExtractorRegistry.resolve("https://rootz.so/dl/12345")
        self.assertIsInstance(ext, RootzExtractor)

    def test_datanodes_resolved(self):
        from crawler.extractors.datanodes import DataNodesExtractor
        ext = ExtractorRegistry.resolve("https://datanodes.to/rpmce0vlrxy1")
        self.assertIsInstance(ext, DataNodesExtractor)

    def test_buzzheavier_resolved(self):
        from crawler.extractors.buzzheavier import BuzzheavierExtractor
        ext = ExtractorRegistry.resolve("https://buzzheavier.com/s062m8hwy33u")
        self.assertIsInstance(ext, BuzzheavierExtractor)
        ext_mirror = ExtractorRegistry.resolve("https://bzzhr.co/abc123")
        self.assertIsInstance(ext_mirror, BuzzheavierExtractor)

    def test_unknown_host_resolves_to_generic(self):
        ext = ExtractorRegistry.resolve("https://unknownhost.org/download")
        self.assertIsInstance(ext, GenericExtractor)


if __name__ == "__main__":
    unittest.main()
