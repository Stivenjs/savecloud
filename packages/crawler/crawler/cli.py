"""Command line interface for SaveCloud Crawler."""

import json
import multiprocessing
import sys

from crawler.config import PROCESS_TIMEOUT_SECONDS
from crawler.core.browser import BrowserManager
from crawler.core.process import WatchdogTimer
from crawler.engine import CrawlerEngine


def write_stdout(text: str) -> None:
    """Writes bytes directly to stdout buffer to prevent UTF-8 encoding issues on Windows."""
    if not text:
        return
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for the crawler."""
    multiprocessing.freeze_support()

    if argv is None:
        argv = sys.argv[1:]

    watchdog = WatchdogTimer(PROCESS_TIMEOUT_SECONDS)
    watchdog.start()

    try:
        BrowserManager.ensure_fetchers_installed()

        if not argv:
            print(json.dumps({"error": "missing url"}), file=sys.stderr)
            return 2

        url = argv[0].strip()
        if not url:
            print(json.dumps({"error": "empty url"}), file=sys.stderr)
            return 2

        engine = CrawlerEngine()
        try:
            result = engine.fetch(url)
            write_stdout(result)
            return 0
        except Exception as exc:
            if BrowserManager.is_missing_browser_error(exc):
                try:
                    BrowserManager.ensure_browsers_installed()
                    result = engine.fetch(url)
                    write_stdout(result)
                    return 0
                except Exception as retry_exc:
                    print(str(retry_exc), file=sys.stderr)
                    return 1

            print(str(exc), file=sys.stderr)
            return 1
    finally:
        watchdog.cancel()


if __name__ == "__main__":
    raise SystemExit(main())
