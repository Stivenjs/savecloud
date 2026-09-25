"""HTML tag stripping and valid JSON extraction."""

import json
import re


def clean_json_from_html(text: str) -> str:
    """Extracts valid JSON substring from HTML responses or wrappers."""
    if not text:
        return ""
    text_stripped = text.strip()
    if text_stripped.startswith("{") or text_stripped.startswith("["):
        return text_stripped

    clean = re.sub(r"<[^>]+>", "", text_stripped)
    clean_stripped = clean.strip()
    if clean_stripped.startswith("{") or clean_stripped.startswith("["):
        return clean_stripped

    first_brace = text_stripped.find("{")
    last_brace = text_stripped.rfind("}")
    first_bracket = text_stripped.find("[")
    last_bracket = text_stripped.rfind("]")

    candidates = []
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(text_stripped[first_brace : last_brace + 1])
    if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
        candidates.append(text_stripped[first_bracket : last_bracket + 1])

    for cand in candidates:
        try:
            json.loads(cand)
            return cand
        except Exception:
            pass

    return text_stripped
