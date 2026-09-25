"""Network request routing, ad-blocking, asset filtering, and referer resolution."""

from urllib.parse import urlparse

from crawler.config import (
    AD_KEYWORDS,
    DEFAULT_HEADERS,
    DEFAULT_REFERER,
    DEFAULT_USER_AGENT,
    IGNORED_EXTENSIONS,
)


def build_headers(
    referer: str | None = None,
    origin: str | None = None,
    accept: str | None = None,
    htmx: bool = False,
    user_agent: str | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    """Builds consistent, modular HTTP headers for requests across the crawler."""
    headers = {
        "User-Agent": user_agent or DEFAULT_USER_AGENT,
        "Accept": accept or DEFAULT_HEADERS.get("Accept", "*/*"),
        "Accept-Language": DEFAULT_HEADERS.get("Accept-Language", "en-US,en;q=0.9"),
    }
    if referer:
        headers["Referer"] = referer
    if origin:
        headers["Origin"] = origin
    if htmx:
        headers["hx-request"] = "true"
        if referer:
            headers["hx-current-url"] = referer
    if extra:
        headers.update(extra)
    return headers


def extract_host(url: str) -> str:
    """Extract lowercase hostname without port from URL."""
    try:
        return urlparse(url).netloc.lower().split(":")[0]
    except Exception:
        return ""


def is_json_url(url: str) -> bool:
    """Checks if the URL path ends with .json."""
    try:
        return urlparse(url).path.lower().endswith(".json")
    except Exception:
        return False


def smart_referer(url: str) -> str:
    """Generates an appropriate referer header for the given target URL."""
    return DEFAULT_REFERER


def is_ad_domain(url: str) -> bool:
    """Checks if URL belongs to known ad, tracking, or popup domains."""
    try:
        url_lower = url.lower()
        return any(kw in url_lower for kw in AD_KEYWORDS)
    except Exception:
        return False


def is_ignored_download_url(url: str) -> bool:
    """Checks if a URL has an ignored static file extension."""
    try:
        lower_path = urlparse(url).path.lower()
        return any(lower_path.endswith(ext) for ext in IGNORED_EXTENSIONS)
    except Exception:
        return False


class RouteInterceptor:
    """Handles Playwright/Patchright page route interception."""

    @classmethod
    def setup_routes(cls, page, target_url: str, expect_json: bool = False) -> None:
        """Sets up route handlers to abort ads and heavy media assets."""
        referer = smart_referer(target_url)

        def handle_route(route, request):
            try:
                req_url = request.url.lower()
                res_type = request.resource_type

                if is_ad_domain(req_url):
                    route.abort()
                    return

                if res_type in ("image", "media", "font"):
                    route.abort()
                    return

                if expect_json and res_type == "stylesheet":
                    route.abort()
                    return

                if request.is_navigation_request():
                    headers = {**request.headers, "Referer": referer}
                    route.continue_(headers=headers)
                else:
                    route.continue_()
            except Exception:
                try:
                    route.continue_()
                except Exception:
                    pass

        try:
            page.route("**/*", handle_route)
        except Exception:
            pass
