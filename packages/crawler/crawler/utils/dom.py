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
    def click_and_wait_navigation(
        cls,
        page: Any,
        selector: str,
        timeout_seconds: int = 15,
        fallback_indicators: str | Iterable[str] = (),
    ) -> bool:
        """Clicks an element matching selector and safely awaits navigation or DOM change."""
        try:
            with page.expect_navigation(timeout=int(timeout_seconds * 1000)):
                cls.click(page, selector)
            return True
        except Exception:
            cls.click(page, selector, force_enable=True)
            if fallback_indicators:
                return cls.wait_for_text(page, fallback_indicators, timeout_seconds=timeout_seconds)
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

    @classmethod
    def is_any_visible(cls, page: Any, selectors: Iterable[str]) -> bool:
        """Checks if any element matching the given selectors exists and is visible."""
        for sel in selectors:
            try:
                locator = page.locator(sel)
                if locator.count() > 0 and locator.first.is_visible():
                    return True
            except Exception:
                continue
        return False

    @staticmethod
    def remove_elements(page: Any, selectors: Iterable[str]) -> None:
        """Removes all elements matching the given selectors from the DOM."""
        try:
            combined = ", ".join(selectors)
            page.evaluate(
                """(sel) => {
                    document.querySelectorAll(sel).forEach(el => el.remove());
                }""",
                combined,
            )
        except Exception:
            pass

    @staticmethod
    def has_iframe_src(page: Any, substring: str) -> bool:
        """Checks if any iframe on the page has a src containing substring."""
        try:
            return bool(page.evaluate(
                """(sub) => Array.from(document.querySelectorAll('iframe')).some(
                    f => (f.src || '').includes(sub)
                )""",
                substring,
            ))
        except Exception:
            return False

    @staticmethod
    def has_input_value(page: Any, selector: str, min_length: int = 1) -> bool:
        """Checks if an element matching selector has value length >= min_length."""
        try:
            return bool(page.evaluate(
                """({ sel, minLen }) => {
                    const el = document.querySelector(sel);
                    return !!el && (el.value || '').length >= minLen;
                }""",
                {"sel": selector, "minLen": min_length},
            ))
        except Exception:
            return False

    @staticmethod
    def smooth_click_point(
        page: Any,
        x: float,
        y: float,
        steps: int = 5,
        pre_delay_ms: int = 100,
    ) -> None:
        """Moves mouse organically to (x, y) with multiple steps and performs a click."""
        try:
            page.mouse.move(x, y, steps=steps)
            if pre_delay_ms > 0:
                page.wait_for_timeout(pre_delay_ms)
            page.mouse.click(x, y)
        except Exception:
            pass

    @classmethod
    def smooth_click_locator(
        cls,
        page: Any,
        locator: Any,
        offset_x: float | None = None,
        offset_y: float | None = None,
        steps: int = 5,
        fallback_timeout_ms: int = 2000,
    ) -> bool:
        """Moves mouse organically to locator bounding box and clicks, or falls back to locator.click()."""
        try:
            box = locator.bounding_box()
            if box:
                if offset_x is not None:
                    target_x = box["x"] + min(offset_x, box["width"] / 2)
                else:
                    target_x = box["x"] + box["width"] / 2

                if offset_y is not None:
                    target_y = box["y"] + min(offset_y, box["height"] / 2)
                else:
                    target_y = box["y"] + box["height"] / 2

                cls.smooth_click_point(page, target_x, target_y, steps=steps)
                return True

            locator.click(timeout=fallback_timeout_ms)
            return True
        except Exception:
            return False
