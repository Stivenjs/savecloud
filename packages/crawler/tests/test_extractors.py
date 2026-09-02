"""Unit tests for individual hoster extractors."""

import unittest
from unittest.mock import MagicMock

from crawler.extractors.base import ExtractionContext
from crawler.extractors.filekeeper import FileKeeperExtractor
from crawler.extractors.generic import GenericExtractor
from crawler.extractors.rootz import RootzExtractor
from crawler.extractors.vikingfile import VikingFileExtractor


class TestExtractors(unittest.TestCase):
    def test_vikingfile_matches(self):
        ext = VikingFileExtractor()
        self.assertTrue(ext.matches("https://vikingfile.com/f/abc123xyz"))
        self.assertTrue(ext.matches("https://sub.vikingfile.com/api/get-server"))
        self.assertFalse(ext.matches("https://example.com/file"))

    def test_vikingfile_on_response(self):
        ext = VikingFileExtractor()
        context = ExtractionContext(target_url="https://vikingfile.com/f/abc")

        # Mock API response with url
        resp1 = MagicMock()
        resp1.url = "https://vikingfile.com/api/get-server"
        resp1.text.return_value = '{"url": "https://storage.vikingfile.com/direct.zip"}'
        ext.on_response(resp1, context)
        self.assertEqual(context.captured_download_url, "https://storage.vikingfile.com/direct.zip")

        # Mock API response with server and hash
        context.captured_download_url = None
        resp2 = MagicMock()
        resp2.url = "https://vikingfile.com/api/get-server"
        resp2.text.return_value = '{"server": "https://srv1.vikingfile.com", "hash": "999888"}'
        ext.on_response(resp2, context)
        self.assertEqual(context.captured_download_url, "https://srv1.vikingfile.com/f/999888")

    def test_filekeeper_matches(self):
        ext = FileKeeperExtractor()
        self.assertTrue(ext.matches("https://filekeeper.net/view/123"))
        self.assertTrue(ext.matches("https://filekeeper.net/api/file/abc"))
        self.assertTrue(ext.requires_browser)
        self.assertFalse(ext.matches("https://vikingfile.com/f/abc"))

    def test_filekeeper_on_response(self):
        ext = FileKeeperExtractor()
        context = ExtractionContext(target_url="https://filekeeper.net/view/123")

        resp = MagicMock()
        resp.url = "https://filekeeper.net/api/file/123"
        resp.text.return_value = '{"data": {"downloadUrl": "https://cdn.filekeeper.net/dl/file.rar"}}'
        ext.on_response(resp, context)
        self.assertEqual(context.captured_download_url, "https://cdn.filekeeper.net/dl/file.rar")

    def test_rootz_matches(self):
        ext = RootzExtractor()
        self.assertTrue(ext.matches("https://rootz.so/d/xyz"))
        self.assertFalse(ext.matches("https://google.com"))

    def test_datanodes_matches(self):
        from crawler.extractors.datanodes import DataNodesExtractor
        ext = DataNodesExtractor()
        self.assertTrue(ext.matches("https://datanodes.to/rpmce0vlrxy1"))
        self.assertTrue(ext.matches("https://datanodes.to/download"))
        self.assertTrue(ext.requires_browser)
        self.assertFalse(ext.matches("https://google.com"))

    def test_generic_matches_anything(self):
        ext = GenericExtractor()
        self.assertTrue(ext.matches("https://anyrandomhost.org/download"))


if __name__ == "__main__":
    unittest.main()
