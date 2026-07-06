use std::sync::LazyLock;

use reqwest::Url;
use scraper::{Html, Selector};

static DOWNLOAD_SELECTORS: LazyLock<Vec<Selector>> = LazyLock::new(|| {
    vec![
        Selector::parse("a[href]").expect("selector a[href]"),
        Selector::parse("form[action]").expect("selector form[action]"),
        Selector::parse("[data-href]").expect("selector [data-href]"),
        Selector::parse("[data-url]").expect("selector [data-url]"),
    ]
});

static INPUT_SELECTOR: LazyLock<Selector> = LazyLock::new(|| {
    Selector::parse("input").expect("selector input")
});

const ASSET_EXTENSIONS: &[&str] = &[
    ".css", ".js", ".mjs", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf",
];

fn normalized_host(url: &Url) -> String {
    url.host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase()
}

fn looks_like_asset_url(url: &Url) -> bool {
    let lower = url.as_str().to_ascii_lowercase();
    ASSET_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

fn has_path_hint(url: &Url) -> bool {
    let lower = url.as_str().to_ascii_lowercase();
    lower.contains("download")
        || lower.contains("/dl")
        || lower.contains("/file")
        || lower.contains("?download")
        || lower.contains("?dl")
}

fn score_candidate(
    url: &Url,
    page_host: &str,
    host_markers: &[&str],
    text_markers: &[&str],
    text: &str,
    raw: &str,
) -> i32 {
    if looks_like_asset_url(url) {
        return i32::MIN / 2;
    }

    let lowered_text = text.to_ascii_lowercase();
    let lowered_raw = raw.to_ascii_lowercase();
    let candidate_host = normalized_host(url);

    let mut score = 0;

    if !candidate_host.is_empty() && candidate_host != page_host {
        score += 8;
    }
    if host_markers
        .iter()
        .any(|marker| candidate_host.contains(marker) || lowered_raw.contains(marker))
    {
        score += 20;
    }
    if has_path_hint(url) {
        score += 12;
    }
    if text_markers
        .iter()
        .any(|marker| lowered_text.contains(marker))
    {
        score += 25;
    }
    if lowered_raw.contains("download") || lowered_raw.contains("dl") {
        score += 8;
    }
    if raw.contains("download=") || raw.contains("dlinline") || raw.contains("dl_no_ssl") {
        score += 30;
    }

    score
}

fn resolve_candidate(page_url: &Url, raw: &str) -> Option<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("javascript:")
        || trimmed.starts_with("mailto:")
    {
        return None;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Url::parse(trimmed).ok();
    }

    if trimmed.starts_with("//") {
        return Url::parse(&format!("{}:{trimmed}", page_url.scheme())).ok();
    }

    page_url.join(trimmed).ok()
}

pub fn has_password_field(html: &str) -> bool {
    let document = Html::parse_document(html);

    document.select(&INPUT_SELECTOR).any(|input| {
        let value = input.value();
        matches!(
            value.attr("name").map(|s| s.eq_ignore_ascii_case("pass")),
            Some(true)
        ) || matches!(
            value.attr("id").map(|s| s.eq_ignore_ascii_case("pass")),
            Some(true)
        ) || value
            .attr("type")
            .map(|s| s.eq_ignore_ascii_case("password"))
            .unwrap_or(false)
    })
}

pub fn extract_download_link(
    html: &str,
    page_url: &str,
    host_markers: &[&str],
    text_markers: &[&str],
) -> Option<String> {
    let page_url = Url::parse(page_url).ok()?;
    let page_host = normalized_host(&page_url);
    let document = Html::parse_document(html);

    let mut best: Option<(i32, String)> = None;

    for selector in DOWNLOAD_SELECTORS.iter() {
        for element in document.select(selector) {
            let value = element.value();
            let raw = value
                .attr("href")
                .or_else(|| value.attr("action"))
                .or_else(|| value.attr("data-href"))
                .or_else(|| value.attr("data-url"))
                .unwrap_or("");

            let Some(candidate) = resolve_candidate(&page_url, raw) else {
                continue;
            };

            let text = element.text().collect::<Vec<_>>().join(" ");
            let mut score = score_candidate(
                &candidate,
                &page_host,
                host_markers,
                text_markers,
                &text,
                raw,
            );

            if value.attr("download").is_some() {
                score += 15;
            }

            if score <= 0 {
                continue;
            }

            let candidate = candidate.to_string();
            match best {
                Some((best_score, _)) if best_score >= score => {}
                _ => best = Some((score, candidate)),
            }
        }
    }

    best.map(|(_, url)| url)
}

pub fn is_url_on_marked_host(url: &str, host_markers: &[&str]) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.trim_start_matches("www.").to_ascii_lowercase()))
        .map(|host| host_markers.iter().any(|marker| host.contains(marker)))
        .unwrap_or(false)
}
