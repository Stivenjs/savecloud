#!/usr/bin/env python3
"""Launcher script for SaveCloud Crawler.

Delegates execution to the modular package in `packages/crawler`.
Maintains 100% backward compatibility with Tauri and PyInstaller.
"""

import os
import sys

# Ensure packages/crawler is in sys.path if not installed globally
try:
    import crawler.cli
except ImportError:
    repo_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
    )
    crawler_pkg = os.path.join(repo_root, "packages", "crawler")
    if os.path.isdir(crawler_pkg) and crawler_pkg not in sys.path:
        sys.path.insert(0, crawler_pkg)

from crawler.cli import main

if __name__ == "__main__":
    raise SystemExit(main())