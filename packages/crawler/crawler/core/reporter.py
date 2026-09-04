"""Crawler progress and event reporter.

Emits structured JSON events on stderr using a dedicated prefix [CRAWLER_EVENT]
to maintain 100% clean stdout output while streaming real-time status updates
to Tauri and UI layers.
"""

import json
import sys


class CrawlerReporter:
    """Emits machine-readable progress events to stderr."""

    PREFIX = "[CRAWLER_EVENT]"

    @classmethod
    def report(cls, stage: str, message: str = "", percent: int | None = None) -> None:
        """Emits a status event.

        Args:
            stage: Machine-readable key (e.g. 'init', 'fast_fetch', 'navigating',
                   'turnstile', 'turnstile_solved', 'waiting_download', 'resolved').
            message: Optional human-readable fallback message.
            percent: Optional numeric completion estimate (0-100).
        """
        payload = {
            "type": "crawler_progress",
            "stage": stage,
            "message": message,
            "percent": percent,
        }
        try:
            sys.stderr.write(f"{cls.PREFIX}{json.dumps(payload)}\n")
            sys.stderr.flush()
        except Exception:
            pass
