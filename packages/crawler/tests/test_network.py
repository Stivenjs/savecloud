"""Unit tests for crawler network utilities and header building."""

import unittest

from crawler.config import DEFAULT_USER_AGENT
from crawler.core.network import (
    build_headers,
    extract_host,
    is_ad_domain,
    is_ignored_download_url,
    is_json_url,
    smart_referer,
)


class TestNetworkUtils(unittest.TestCase):
    def test_build_headers_default(self):
        headers = build_headers()
        self.assertIn("User-Agent", headers)
        self.assertEqual(headers["User-Agent"], DEFAULT_USER_AGENT)
        self.assertIn("Accept", headers)
        self.assertNotIn("Referer", headers)
        self.assertNotIn("hx-request", headers)

    def test_build_headers_with_referer_and_origin(self):
        headers = build_headers(
            referer="https://rootz.so/d/xyz",
            origin="https://rootz.so",
            accept="application/json",
        )
        self.assertEqual(headers["Referer"], "https://rootz.so/d/xyz")
        self.assertEqual(headers["Origin"], "https://rootz.so")
        self.assertEqual(headers["Accept"], "application/json")

    def test_build_headers_htmx(self):
        headers = build_headers(
            referer="https://buzzheavier.com/file123",
            htmx=True,
        )
        self.assertEqual(headers["hx-request"], "true")
        self.assertEqual(headers["hx-current-url"], "https://buzzheavier.com/file123")
        self.assertEqual(headers["Referer"], "https://buzzheavier.com/file123")

    def test_build_headers_extra(self):
        headers = build_headers(extra={"X-Page-Token": "token_abc_123"})
        self.assertEqual(headers["X-Page-Token"], "token_abc_123")

    def test_extract_host(self):
        self.assertEqual(extract_host("https://www.rootz.so/d/123"), "www.rootz.so")
        self.assertEqual(extract_host("https://buzzheavier.com:8080/path"), "buzzheavier.com")
        self.assertEqual(extract_host("not-a-url"), "")

    def test_is_json_url(self):
        self.assertTrue(is_json_url("https://example.com/api/file.json"))
        self.assertFalse(is_json_url("https://example.com/api/file.zip"))

    def test_is_ad_domain(self):
        self.assertTrue(is_ad_domain("https://adcash.com/script.js"))
        self.assertFalse(is_ad_domain("https://buzzheavier.com/dl/123"))

    def test_is_ignored_download_url(self):
        self.assertTrue(is_ignored_download_url("https://example.com/style.css"))
        self.assertTrue(is_ignored_download_url("https://example.com/image.png"))
        self.assertFalse(is_ignored_download_url("https://example.com/game.zip"))


class TestSessionManager(unittest.TestCase):
    def test_save_and_retrieve_playwright_cookies(self):
        from crawler.core.session import SessionManager
        url = "https://datanodes.to/download/test"
        cookies = [
            {"name": "cf_clearance", "value": "secret_token_123", "domain": "datanodes.to", "path": "/"}
        ]
        SessionManager.save_session(url, cookies, user_agent="TestUA", ttl_seconds=60)
        retrieved = SessionManager.get_cookie_list_for_playwright(url)
        self.assertTrue(any(c["name"] == "cf_clearance" and c["value"] == "secret_token_123" for c in retrieved))


if __name__ == "__main__":
    unittest.main()
