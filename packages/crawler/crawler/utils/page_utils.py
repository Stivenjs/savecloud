"""DOM and response body extraction helpers."""

import json
from typing import Any


def extract_body(page: Any) -> str:
    """Extracts raw text/HTML or JSON content from a response or Page object."""
    try:
        if hasattr(page, "json"):
            val = page.json()
            if callable(val):
                val = val()
            if val:
                return json.dumps(val)
    except Exception:
        pass

    for attr in ("body", "html_content", "content", "text"):
        if not hasattr(page, attr):
            continue
        value = getattr(page, attr)
        if callable(value):
            try:
                value = value()
            except TypeError:
                pass
        if value is None:
            continue
        if isinstance(value, bytes):
            if not value:
                continue
            try:
                return value.decode("utf-8", "replace")
            except Exception:
                pass
        else:
            val_str = str(value)
            if not val_str:
                continue
            return val_str

    try:
        if hasattr(page, "get_all_text"):
            text = page.get_all_text()
            if text and text.strip():
                return text
    except Exception:
        pass

    return str(page)
