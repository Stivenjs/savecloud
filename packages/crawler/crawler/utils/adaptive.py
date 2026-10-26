"""Scrapling Adaptive integration for resilient browser action selectors."""

import sys
from typing import Any

from crawler.core.session import SessionManager


class AdaptiveDom:
    """Learns stable action elements and relocates them when a hoster changes its DOM."""

    _PAGE_STATE_ATTRIBUTE = "_savecloud_adaptive_selector_state"

    @classmethod
    def resolve_selector(cls, page: Any, selector: str) -> str | None:
        """Returns a live Playwright selector, learning or adapting it with Scrapling."""
        try:
            html = page.content()
            page_url = page.url
            parser = cls._get_parser(page, html, page_url)

            # Scrapling supports CSS3, while some Playwright-only selectors (such as
            # :has-text()) are intentionally left to the existing Playwright path.
            matches = parser.css(
                selector,
                identifier=f"savecloud-action:{selector}",
                adaptive=True,
                auto_save=True,
            )
            if not matches:
                return None

            # Preserve the original selector whenever it still works in the live DOM.
            try:
                if page.locator(selector).count() > 0:
                    return selector
            except Exception:
                pass

            element = matches[0]
            if not cls._is_action_element(element):
                return None

            relocated_selector = element.generate_full_css_selector
            if callable(relocated_selector):
                relocated_selector = relocated_selector()
            if not isinstance(relocated_selector, str) or not relocated_selector.strip():
                return None

            try:
                if page.locator(relocated_selector).count() > 0:
                    sys.stderr.write(
                        f"[Scrapling Adaptive] Relocated action selector: {selector} -> "
                        f"{relocated_selector}\n"
                    )
                    return relocated_selector
            except Exception:
                pass
        except Exception:
            # Adaptive parsing must never prevent the existing hoster logic from running.
            pass

        return None

    @classmethod
    def _get_parser(cls, page: Any, html: str, page_url: str) -> Any:
        state = getattr(page, cls._PAGE_STATE_ATTRIBUTE, None)
        if state and state[0] == html and state[1] == page_url:
            return state[2]

        from scrapling.parser import Selector

        storage_file = SessionManager.get_adaptive_storage_file_path()
        parser = Selector(
            content=html,
            url=page_url,
            adaptive=True,
            storage_args={"storage_file": storage_file, "url": page_url},
        )
        try:
            setattr(page, cls._PAGE_STATE_ATTRIBUTE, (html, page_url, parser))
        except Exception:
            pass
        return parser

    @staticmethod
    def _is_action_element(element: Any) -> bool:
        tag = str(getattr(element, "tag", "")).lower()
        attributes = getattr(element, "attrib", {}) or {}
        return tag in {"a", "button", "input", "label", "summary"} or (
            attributes.get("role", "").lower() in {"button", "radio", "link"}
        ) or "hx-get" in attributes or "hx-post" in attributes
