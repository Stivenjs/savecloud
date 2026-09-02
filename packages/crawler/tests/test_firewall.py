"""Unit tests for Firewall and Bot challenge detection."""

import unittest

from crawler.core.firewall import FirewallDetector


class TestFirewallDetector(unittest.TestCase):
    def test_cloudflare_turnstile_detection(self):
        cf_html = "<html><head><title>Just a moment...</title></head><body><div class='cf-turnstile'></div></body></html>"
        self.assertTrue(FirewallDetector.is_challenge(cf_html))

    def test_cloudflare_ray_id_detection(self):
        cf_html = "<html><body>Cloudflare Ray ID: 8c123456789</body></html>"
        self.assertTrue(FirewallDetector.is_challenge(cf_html))

    def test_aws_waf_detection(self):
        waf_html = "<html><body>awswaf token.awswaf.com challenge</body></html>"
        self.assertTrue(FirewallDetector.is_challenge(waf_html))

    def test_clean_html_not_detected_as_challenge(self):
        clean_html = "<html><head><title>My Files</title></head><body><a href='/download'>Download</a></body></html>"
        self.assertFalse(FirewallDetector.is_challenge(clean_html))

    def test_validate_content_json(self):
        valid_json = '{"success": true}'
        self.assertEqual(FirewallDetector.validate_content(valid_json, expect_json=True), valid_json)

    def test_validate_content_blocked_returns_none(self):
        blocked = "<html><body>Just a moment... cf-turnstile</body></html>"
        self.assertIsNone(FirewallDetector.validate_content(blocked, expect_json=False))


if __name__ == "__main__":
    unittest.main()
