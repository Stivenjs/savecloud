"""Reusable DOM interaction and polling helpers for crawler extractors."""

import sys
from typing import Any, Iterable


class DomHelper:
    """Provides high-level, declarative browser DOM interaction utilities."""

    @staticmethod
    def _normalize_patterns(patterns: str | Iterable[str]) -> list[str]:
        if isinstance(patterns, str):
            return [patterns.lower()]
        return [p.lower() for p in patterns if p]

    @classmethod
    def has_text(cls, page: Any, patterns: str | Iterable[str]) -> bool:
        """Checks if the page body contains any of the given text patterns."""
        try:
            norm_patterns = cls._normalize_patterns(patterns)
            return page.evaluate(
                """(patterns) => {
                    const text = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                    return patterns.some(p => text.includes(p));
                }""",
                norm_patterns,
            )
        except Exception:
            return False

    @staticmethod
    def exists(page: Any, selector: str) -> bool:
        """Checks if an element matching selector exists in the DOM."""
        try:
            return page.evaluate(
                """(sel) => !!document.querySelector(sel)""",
                selector,
            )
        except Exception:
            return False

    @staticmethod
    def is_enabled(page: Any, selector: str) -> bool:
        """Checks if an element matching selector exists and is not disabled."""
        try:
            return page.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel);
                    return !!el && !el.disabled;
                }""",
                selector,
            )
        except Exception:
            return False

    @classmethod
    def wait_until_enabled(
        cls,
        page: Any,
        selector: str,
        timeout_seconds: int = 10,
        poll_interval: float = 1.0,
    ) -> bool:
        """Polls until selector is enabled or timeout expires."""
        for _ in range(timeout_seconds):
            if cls.is_enabled(page, selector):
                return True
            page.wait_for_timeout(int(poll_interval * 1000))
        return False

    @classmethod
    def wait_for_text(
        cls,
        page: Any,
        patterns: str | Iterable[str],
        timeout_seconds: int = 10,
        poll_interval: float = 1.0,
    ) -> bool:
        """Polls until any of the text patterns appear in page body."""
        for _ in range(timeout_seconds):
            if cls.has_text(page, patterns):
                return True
            page.wait_for_timeout(int(poll_interval * 1000))
        return False

    @staticmethod
    def click(page: Any, selector: str, force_enable: bool = False) -> bool:
        """Finds element matching selector, optionally enables it, and clicks it."""
        try:
            clicked = page.evaluate(
                """({ sel, forceEnable }) => {
                    const el = document.querySelector(sel);
                    if (el) {
                        if (forceEnable) el.disabled = false;
                        if (typeof el.scrollIntoView === 'function') el.scrollIntoView();
                        el.click();
                        return true;
                    }
                    return false;
                }""",
                {"sel": selector, "forceEnable": force_enable},
            )
            if clicked:
                return True

            locator = page.locator(selector).first
            if locator.is_visible():
                locator.click(force=True)
                return True
        except Exception:
            pass
        return False

    @classmethod
    def click_button_with_text(
        cls,
        page: Any,
        patterns: str | Iterable[str],
        exclude_patterns: str | Iterable[str] = (),
    ) -> bool:
        """Finds and clicks a button, link, or submit input matching patterns."""
        try:
            include_list = cls._normalize_patterns(patterns)
            exclude_list = cls._normalize_patterns(exclude_patterns)

            clicked = page.evaluate(
                """({ includes, excludes }) => {
                    const elements = Array.from(
                        document.querySelectorAll('button, a, input[type=submit]')
                    );
                    const target = elements.find(el => {
                        const t = (el.innerText || el.value || '').trim().toLowerCase();
                        const matchesInclude = includes.some(inc => t.includes(inc));
                        const matchesExclude = excludes.some(exc => t.includes(exc));
                        return matchesInclude && !matchesExclude;
                    });
                    if (target) {
                        if (typeof target.scrollIntoView === 'function') target.scrollIntoView();
                        target.click();
                        return true;
                    }
                    return false;
                }""",
                {"includes": include_list, "excludes": exclude_list},
            )
            if clicked:
                return True

            for pattern in include_list:
                try:
                    locator = page.locator(f"button:has-text('{pattern}'), a:has-text('{pattern}')").first
                    if locator.is_visible():
                        locator.click(force=True)
                        return True
                except Exception:
                    continue
        except Exception:
            pass
        return False

    @classmethod
    def wait_and_click_button(
        cls,
        page: Any,
        patterns: str | Iterable[str],
        exclude_patterns: str | Iterable[str] = ("premium", "torrent", "app", "skip", "discord"),
        max_wait_seconds: int = 20,
        context: Any = None,
        poll_interval: float = 1.0,
        exact: bool = False,
    ) -> bool:
        """Waits for countdown/loading and clicks button when it becomes available."""
        include_list = cls._normalize_patterns(patterns)
        exclude_list = cls._normalize_patterns(exclude_patterns)
        for sec in range(max_wait_seconds):
            if context and getattr(context, "captured_download_url", None):
                return True

            clicked = page.evaluate(
                """({ includes, excludes, isExact }) => {
                    const elements = Array.from(
                        document.querySelectorAll('button, a, input[type=submit]')
                    ).filter(el => el.offsetParent !== null);

                    const target = elements.find(el => {
                        const t = (el.innerText || el.value || '').trim().toLowerCase();
                        const href = (el.href || '').toLowerCase();
                        if (excludes.some(exc => t.includes(exc) || href.includes(exc))) {
                            return false;
                        }
                        if (isExact) {
                            return includes.some(inc => t === inc);
                        }
                        return includes.some(inc => t === inc || t.includes(inc));
                    });
                    if (target) {
                        if (typeof target.scrollIntoView === 'function') target.scrollIntoView();
                        target.click();
                        return true;
                    }
                    return false;
                }""",
                {"includes": include_list, "excludes": exclude_list, "isExact": exact},
            )
            if clicked:
                sys.stderr.write(f"[DomHelper] Button triggered at {sec+1}s!\n")
                return True

            page.wait_for_timeout(int(poll_interval * 1000))

        return False

    @staticmethod
    def wait_for_capture(
        context: Any,
        page: Any = None,
        timeout_seconds: int = 8,
        poll_interval: float = 1.0,
    ) -> str | None:
        """Waits up to timeout_seconds for context.captured_download_url to be set."""
        for _ in range(timeout_seconds):
            url = getattr(context, "captured_download_url", None)
            if url:
                return url
            if page:
                page.wait_for_timeout(int(poll_interval * 1000))
        return getattr(context, "captured_download_url", None)

    @classmethod
    def find_first_href(cls, page: Any, selectors: Iterable[str]) -> str | None:
        """Finds the first visible element matching any of the selectors and returns its http href."""
        for sel in selectors:
            try:
                elements = page.locator(sel)
                if elements.count() > 0 and elements.first.is_visible():
                    href = elements.first.get_attribute("href")
                    if href and href.startswith("http"):
                        return href
            except Exception:
                continue
        return None

    @staticmethod
    def click_first_visible(page: Any, selectors: Iterable[str]) -> bool:
        """Finds the first visible element matching any of the selectors and clicks it."""
        for sel in selectors:
            try:
                elements = page.locator(sel)
                if elements.count() > 0:
                    first_el = elements.first
                    if first_el.is_visible():
                        first_el.click()
                        return True
            except Exception:
                continue
        return False

    @classmethod
    def poll_for_href(
        cls,
        page: Any,
        selectors: Iterable[str],
        context: Any = None,
        max_wait_seconds: int = 15,
        poll_interval: float = 1.0,
    ) -> str | None:
        """Polls until a valid href is found from selectors or context captures a URL."""
        for _ in range(max_wait_seconds):
            if context and getattr(context, "captured_download_url", None):
                return context.captured_download_url

            href = cls.find_first_href(page, selectors)
            if href:
                if context:
                    context.captured_download_url = href
                return href

            page.wait_for_timeout(int(poll_interval * 1000))

        return getattr(context, "captured_download_url", None) if context else None
