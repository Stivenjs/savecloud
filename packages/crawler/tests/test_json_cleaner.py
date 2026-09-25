"""Unit tests for JSON cleaning and extraction."""

import json
import unittest

from crawler.utils.json_cleaner import clean_json_from_html


class TestJsonCleaner(unittest.TestCase):
    def test_pure_json_object(self):
        payload = '{"status": "ok", "url": "https://example.com"}'
        result = clean_json_from_html(payload)
        self.assertEqual(result, payload)
        self.assertEqual(json.loads(result)["status"], "ok")

    def test_pure_json_array(self):
        payload = '[{"id": 1}, {"id": 2}]'
        result = clean_json_from_html(payload)
        self.assertEqual(result, payload)
        self.assertEqual(len(json.loads(result)), 2)

    def test_html_wrapped_json(self):
        html = '<html><body><pre>{"data": 123}</pre></body></html>'
        result = clean_json_from_html(html)
        self.assertEqual(json.loads(result), {"data": 123})

    def test_noisy_text_with_json(self):
        text = 'random noise before {"valid": true, "count": 5} and noise after'
        result = clean_json_from_html(text)
        self.assertEqual(json.loads(result), {"valid": True, "count": 5})

    def test_empty_input(self):
        self.assertEqual(clean_json_from_html(""), "")
        self.assertEqual(clean_json_from_html(None), "")


if __name__ == "__main__":
    unittest.main()
