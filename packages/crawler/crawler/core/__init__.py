"""Low-level core subsystems for SaveCloud Crawler."""

from crawler.core.browser import BrowserManager
from crawler.core.firewall import FirewallDetector, TurnstileSolver
from crawler.core.network import RouteInterceptor
from crawler.core.process import ProcessManager, WatchdogTimer
from crawler.core.reporter import CrawlerReporter

__all__ = [
    "BrowserManager",
    "FirewallDetector",
    "TurnstileSolver",
    "RouteInterceptor",
    "ProcessManager",
    "WatchdogTimer",
    "CrawlerReporter",
]
