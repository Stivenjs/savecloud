"""Fetch strategies package."""

from crawler.strategies.base import FetchStrategy
from crawler.strategies.fast_fetch import FastFetchStrategy
from crawler.strategies.stealth_browser import StealthBrowserStrategy

__all__ = ["FetchStrategy", "FastFetchStrategy", "StealthBrowserStrategy"]
