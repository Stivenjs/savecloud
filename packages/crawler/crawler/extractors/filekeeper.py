"""Extractor for FileKeeper hosting platform."""

import json
import sys
from typing import Any

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class FileKeeperExtractor(BaseExtractor):
    """Handles FileKeeper links and intercepts /api/file and /api/contents responses."""

    name: str = "filekeeper"
    priority: int = 80

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return "filekeeper.net" in host or "api/file" in url.lower() or "api/contents" in url.lower()

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            if "api/file" in response_url or "api/contents" in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                link = self._extract_url_from_data(data)
                if link:
                    context.captured_download_url = link
                    sys.stderr.write(f"[FileKeeper] Captured direct link: {link}\n")
        except Exception as e:
            sys.stderr.write(f"[FileKeeper] Error parsing API response: {e}\n")

    @staticmethod
    def _extract_url_from_data(data: Any) -> str | None:
        if not isinstance(data, dict):
            return None
        for key in ("url", "downloadUrl", "directLink", "link"):
            if data.get(key):
                return str(data[key])
        if isinstance(data.get("data"), dict):
            for key in ("url", "downloadUrl", "directLink", "link"):
                if data["data"].get(key):
                    return str(data["data"][key])
        return None
