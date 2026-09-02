import unittest
from unittest.mock import MagicMock

from crawler.extractors.base import ExtractionContext
from crawler.utils.dom import DomHelper


class TestDomHelper(unittest.TestCase):
    def test_normalize_patterns(self):
        self.assertEqual(DomHelper._normalize_patterns("Download"), ["download"])
        self.assertEqual(
            DomHelper._normalize_patterns(["Download", "START", ""]),
            ["download", "start"],
        )

    def test_has_text(self):
        page = MagicMock()
        page.evaluate.return_value = True
        self.assertTrue(DomHelper.has_text(page, ["Continue", "Verify"]))
        page.evaluate.assert_called_once()

    def test_exists_and_is_enabled(self):
        page = MagicMock()
        page.evaluate.return_value = True
        self.assertTrue(DomHelper.exists(page, "#method_free"))
        self.assertTrue(DomHelper.is_enabled(page, "#method_free"))

    def test_wait_for_capture(self):
        context = ExtractionContext(target_url="https://example.com")
        context.captured_download_url = "https://dl.example.com/file.zip"
        res = DomHelper.wait_for_capture(context, timeout_seconds=1)
        self.assertEqual(res, "https://dl.example.com/file.zip")


if __name__ == "__main__":
    unittest.main()
