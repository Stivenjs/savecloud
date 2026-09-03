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
        self.assertTrue(ext.matches("https://www.rootz.so/d/2KssK0"))
        self.assertTrue(ext.matches("https://rootz.so/file/abcdef123"))
        self.assertFalse(ext.matches("https://google.com"))
        self.assertFalse(ext.matches("https://example.com/rootz"))

    def test_rootz_extract_helpers(self):
        self.assertEqual(RootzExtractor.extract_short_id("https://rootz.so/d/2KssK0"), "2KssK0")
        self.assertEqual(RootzExtractor.extract_short_id("https://www.rootz.so/file/uuid-1234"), "uuid-1234")
        html_chunk = r'5:[null,{"shortId":"2KssK0","pageToken":"token_abc123_xyz"}]'
        self.assertEqual(RootzExtractor.extract_page_token(html_chunk), "token_abc123_xyz")

    def test_rootz_extract_from_content_fast_fetch(self):
        ext = RootzExtractor()
        context = ExtractionContext(target_url="https://rootz.so/d/2KssK0")
        html = r'5:[{"shortId":"2KssK0","pageToken":"tok123"}]'

        # Mock API responses
        mock_meta = {
            "fileName": "Game.zip",
            "fileId": "uuid-999",
            "status": "active",
            "downloadAllowed": True,
            "passwordProtected": False,
        }
        with unittest.mock.patch.object(ext, "_http_get_json", return_value=mock_meta):
            with unittest.mock.patch.object(
                ext,
                "_resolve_proxy_redirect",
                return_value="https://cdn.alcyone.so/download/Game.zip",
            ):
                result = ext.extract_from_content(html, context)
                self.assertEqual(result, "https://cdn.alcyone.so/download/Game.zip")
                self.assertEqual(context.captured_download_url, "https://cdn.alcyone.so/download/Game.zip")
                self.assertEqual(context.metadata.get("fileName"), "Game.zip")

    def test_rootz_extract_from_content_deleted(self):
        ext = RootzExtractor()
        context = ExtractionContext(target_url="https://rootz.so/d/2KssK0")
        html = r'5:[{"shortId":"2KssK0","pageToken":"tok123"}]'

        mock_meta = {
            "fileName": "Game.zip",
            "status": "deleted",
            "downloadAllowed": False,
        }
        with unittest.mock.patch.object(ext, "_http_get_json", return_value=mock_meta):
            result = ext.extract_from_content(html, context)
            self.assertIsNone(result)

    def test_rootz_on_response(self):
        ext = RootzExtractor()
        context = ExtractionContext(target_url="https://rootz.so/d/2KssK0")

        # 1. CDN URL directly
        resp_cdn = MagicMock()
        resp_cdn.url = "https://bucket.alcyone.so/files/game.zip?token=xyz"
        ext.on_response(resp_cdn, context)
        self.assertEqual(context.captured_download_url, "https://bucket.alcyone.so/files/game.zip?token=xyz")

        # 2. Proxy-download location header
        context.captured_download_url = None
        resp_proxy = MagicMock()
        resp_proxy.url = "https://rootz.so/api/files/proxy-download/2KssK0"
        resp_proxy.headers = {"location": "https://pub.cloudflarestorage.com/download/game.zip"}
        ext.on_response(resp_proxy, context)
        self.assertEqual(
            context.captured_download_url,
            "https://pub.cloudflarestorage.com/download/game.zip",
        )

    def test_rootz_on_download(self):
        ext = RootzExtractor()
        context = ExtractionContext(target_url="https://rootz.so/d/2KssK0")

        download = MagicMock()
        download.url = "https://cdn.alcyone.so/files/game.zip"
        ext.on_download(download, context)
        self.assertEqual(context.captured_download_url, "https://cdn.alcyone.so/files/game.zip")
        download.cancel.assert_called_once()

    def test_datanodes_matches(self):
        from crawler.extractors.datanodes import DataNodesExtractor
        ext = DataNodesExtractor()
        self.assertTrue(ext.matches("https://datanodes.to/rpmce0vlrxy1"))
        self.assertTrue(ext.matches("https://datanodes.to/download"))
        self.assertTrue(ext.requires_browser)
        self.assertEqual(ext.browser_timeout_ms, 60000)
        self.assertFalse(ext.matches("https://google.com"))

    def test_datanodes_on_response(self):
        from crawler.extractors.datanodes import DataNodesExtractor
        ext = DataNodesExtractor()
        context = ExtractionContext(target_url="https://datanodes.to/rpmce0vlrxy1")

        resp = MagicMock()
        resp.url = "https://tunnel5.dlproxy.uk/download/abc123xyz"
        resp.headers = {"content-disposition": "attachment; filename=game.zip"}
        ext.on_response(resp, context)
        self.assertEqual(context.captured_download_url, "https://tunnel5.dlproxy.uk/download/abc123xyz")

    def test_datanodes_on_download(self):
        from crawler.extractors.datanodes import DataNodesExtractor
        ext = DataNodesExtractor()
        context = ExtractionContext(target_url="https://datanodes.to/rpmce0vlrxy1")

        download = MagicMock()
        download.url = "https://tunnel5.dlproxy.uk/download/game.zip"
        ext.on_download(download, context)
        self.assertEqual(context.captured_download_url, "https://tunnel5.dlproxy.uk/download/game.zip")
        download.cancel.assert_called_once()

    def test_gofile_matches(self):
        from crawler.extractors.gofile import GofileExtractor
        ext = GofileExtractor()
        self.assertTrue(ext.matches("https://gofile.io/d/1hEOBZ"))
        self.assertTrue(ext.requires_browser)
        self.assertFalse(ext.matches("https://google.com"))

    def test_gofile_on_response(self):
        from crawler.extractors.gofile import GofileExtractor
        ext = GofileExtractor()
        context = ExtractionContext(target_url="https://gofile.io/d/1hEOBZ")

        resp = MagicMock()
        resp.url = "https://store-na-phx-3.gofile.io/download/web/82f39d2b/GOW.zip"
        ext.on_response(resp, context)
        self.assertEqual(context.captured_download_url, "https://store-na-phx-3.gofile.io/download/web/82f39d2b/GOW.zip")

    def test_generic_matches_anything(self):
        ext = GenericExtractor()
        self.assertTrue(ext.matches("https://anyrandomhost.org/download"))


if __name__ == "__main__":
    unittest.main()
