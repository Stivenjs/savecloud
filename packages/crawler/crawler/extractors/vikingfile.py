"""Extractor for VikingFile hosting platform."""

import json
import sys

from crawler.core.network import extract_host
from crawler.extractors.base import BaseExtractor, ExtractionContext


class VikingFileExtractor(BaseExtractor):
    """Handles VikingFile links and intercepts /api/get-server responses."""

    name: str = "vikingfile"
    priority: int = 80

    def matches(self, url: str) -> bool:
        host = extract_host(url)
        return (
            "vikingfile.com" in host
            or "vik1ngfile.site" in host
            or "vik1ngfile" in host
            or "api/get-server" in url.lower()
        )

    def on_response(self, response, context: ExtractionContext) -> None:
        try:
            response_url = getattr(response, "url", "") or ""
            if "api/get-server" in response_url:
                body_text = response.text()
                data = json.loads(body_text)
                if data.get("url"):
                    context.captured_download_url = data["url"]
                    sys.stderr.write(f"[VikingFile] Found direct url in API response: {data['url']}\n")
                elif data.get("server") and data.get("hash"):
                    resolved = f"{data['server'].rstrip('/')}/f/{data['hash']}"
                    context.captured_download_url = resolved
                    sys.stderr.write(f"[VikingFile] Built direct url from server and hash: {resolved}\n")
        except Exception as e:
            sys.stderr.write(f"[VikingFile] Error parsing API response: {e}\n")
