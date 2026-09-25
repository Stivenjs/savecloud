#!/usr/bin/env python3
"""Direct entrypoint script for executing crawler without package installation."""

import os
import sys

# Ensure this package directory is in sys.path
package_dir = os.path.dirname(os.path.abspath(__file__))
if package_dir not in sys.path:
    sys.path.insert(0, package_dir)

from crawler.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
