use regex::Regex;
use std::sync::LazyLock;

use crate::compat::types::ParsedRequirements;

static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").expect("tag regex"));
static NBSP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&nbsp;").expect("nbsp regex"));
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("ws regex"));

pub fn parse_requirements_html(html: Option<&str>) -> ParsedRequirements {
    let Some(raw) = html.map(str::trim).filter(|s| !s.is_empty()) else {
        return ParsedRequirements::default();
    };

    let text = normalize_requirements_text(raw);
    ParsedRequirements {
        ram_mb: extract_ram_mb(&text),
        storage_gb: extract_storage_gb(&text),
        directx: extract_directx(&text),
        gpu_text: extract_gpu_line(&text),
    }
}

fn extract_gpu_line(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let keys = ["gráficos:", "graficos:", "graphics:", "gpu:"];
    for key in keys {
        let Some(pos) = lower.find(key) else {
            continue;
        };
        let start = pos + key.len();
        let rest = text.get(start..).unwrap_or("").trim_start();
        let clipped = clip_gpu_section(rest);
        let trimmed = clipped.trim().trim_end_matches(|c| c == ',' || c == '.');
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn clip_gpu_section(rest: &str) -> &str {
    let rl = rest.to_lowercase();
    let enders = [
        "directx",
        "red:",
        "network:",
        "notas adicionales",
        "additional notes",
        "almacenamiento:",
        "storage:",
        "notes:",
        "notas:",
    ];
    let mut end = rest.len();
    for e in enders {
        if let Some(p) = rl.find(e) {
            if p < end {
                end = p;
            }
        }
    }
    rest.get(..end).unwrap_or(rest).trim()
}

fn normalize_requirements_text(html: &str) -> String {
    let s = html
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("<br />", " ");
    let no_tags = TAG_RE.replace_all(&s, " ");
    let no_nbsp = NBSP_RE.replace_all(&no_tags, " ");
    let collapsed = WS_RE.replace_all(no_nbsp.as_ref(), " ");
    collapsed.trim().to_string()
}

fn extract_ram_mb(text: &str) -> Option<u64> {
    let lower = text.to_lowercase();
    let ram_line = RAM_HINT.iter().find_map(|hint| {
        lower
            .split(|c: char| c == '\n' || c == '•' || c == '·')
            .map(str::trim)
            .find(|line| line.contains(hint))
            .map(|s| s.to_string())
    });

    let segment = ram_line.as_deref().unwrap_or(&lower);

    if let Some(mb) = extract_mb_from_segment(segment) {
        return Some(mb);
    }

    if let Some(gb) = extract_gb_near_keywords(segment, &RAM_NEAR) {
        return Some(gb * 1024);
    }

    None
}

static RAM_HINT: &[&str] = &["memoria:", "memory:", "ram:", "memoria ", "memory "];

static RAM_NEAR: &[&str] = &["ram", "memoria", "memory"];

fn extract_mb_from_segment(segment: &str) -> Option<u64> {
    static MB_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(\d+)\s*mb(?:\s*(?:de\s*)?(?:ram|memoria|memory))?").expect("mb re")
    });
    MB_RE
        .captures_iter(segment)
        .filter_map(|c| c.get(1)?.as_str().parse::<u64>().ok())
        .map(|mb| mb.max(1))
        .next()
}

/// Ventana por offsets de byte del regex; los cortes arbitrarios pueden caer dentro de UTF-8 (ej. `ó`).
fn byte_context_window(s: &str, start: usize, end: usize) -> &str {
    let len = s.len();
    let mut a = start.min(len);
    let mut b = end.min(len);
    while a < len && !s.is_char_boundary(a) {
        a += 1;
    }
    while b > a && !s.is_char_boundary(b) {
        b -= 1;
    }
    s.get(a..b).unwrap_or("")
}

fn extract_gb_near_keywords(segment: &str, keywords: &[&str]) -> Option<u64> {
    static GB_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(\d+)\s*gb").expect("gb re"));

    for cap in GB_RE.captures_iter(segment) {
        let m = cap.get(0)?;
        let window = byte_context_window(segment, m.start().saturating_sub(48), m.end() + 48);
        let window_lower = window.to_lowercase();
        if keywords.iter().any(|k| window_lower.contains(k)) {
            return cap.get(1)?.as_str().parse::<u64>().ok();
        }
    }
    None
}

fn extract_storage_gb(text: &str) -> Option<u64> {
    let lower = text.to_lowercase();
    let segment = STORAGE_HINT
        .iter()
        .find_map(|hint| {
            lower
                .split(|c: char| c == '\n' || c == '•' || c == '·')
                .map(str::trim)
                .find(|line| line.contains(hint))
                .map(|s| s.to_string())
        })
        .unwrap_or(lower);

    static STORAGE_GB_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)(\d+)\s*gb").expect("storage gb re"));

    STORAGE_GB_RE
        .captures_iter(&segment)
        .filter_map(|c| {
            let m = c.get(0)?;
            let tail = segment.get(m.end()..).unwrap_or("").trim_start();
            if tail.to_lowercase().starts_with("vram") {
                return None;
            }
            let win = byte_context_window(&segment, m.start().saturating_sub(64), m.end() + 64);
            let win_lower = win.to_lowercase();
            if STORAGE_NEAR.iter().any(|k| win_lower.contains(k)) {
                c.get(1)?.as_str().parse::<u64>().ok()
            } else {
                None
            }
        })
        .next()
}

static STORAGE_HINT: &[&str] = &[
    "available space",
    "espacio disponible",
    "hard drive",
    "disco duro",
    "storage",
    "almacenamiento",
];

static STORAGE_NEAR: &[&str] = &[
    "available",
    "libre",
    "espacio",
    "space",
    "storage",
    "disco",
    "disk",
    "drive",
    "almacenamiento",
];

fn extract_directx(text: &str) -> Option<u32> {
    static DX_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)directx[^\d]{0,12}(\d{1,2})").expect("dx re"));
    DX_RE
        .captures(text)
        .and_then(|c| c.get(1)?.as_str().parse::<u32>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spanish_ram_line_gb() {
        let html = "<li><strong>Memoria:</strong> 8 GB de RAM</li>";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.ram_mb, Some(8 * 1024));
    }

    #[test]
    fn english_ram_line_gb() {
        let html = "<li><strong>Memory:</strong> 4 GB RAM</li>";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.ram_mb, Some(4 * 1024));
    }

    #[test]
    fn ram_mb_value() {
        let html = "Memory: 2048 MB RAM";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.ram_mb, Some(2048));
    }

    #[test]
    fn directx_version() {
        let html = "DirectX: Version 11";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.directx, Some(11));
    }

    #[test]
    fn storage_line() {
        let html = "<li>20 GB available space</li>";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.storage_gb, Some(20));
    }

    #[test]
    fn utf8_spanish_steam_block_no_panic() {
        let html = "Mínimo: requiere un procesador y un sistema operativo de 64 bits SO: Windows 10 (64 bit) \
                    Procesador: AMD Ryzen 3 1200 / Intel Core i5-7500 Memoria: 8 GB de RAM Gráficos: AMD Radeon RX 560 \
                    con 4GB VRAM DirectX: Versión 11 Almacenamiento: 50 GB de espacio disponible";
        let p = parse_requirements_html(Some(html));
        assert_eq!(p.ram_mb, Some(8 * 1024));
        assert_eq!(p.storage_gb, Some(50));
        assert!(p
            .gpu_text
            .as_deref()
            .is_some_and(|g| g.contains("Radeon RX 560")));
    }

    #[test]
    fn extract_gpu_line_from_store_format() {
        let html = "Gráficos: AMD Radeon RX 560 with 4GB VRAM / NVIDIA GeForce GTX 1050 Ti with 4GB VRAM\n\
                    DirectX: Versión 12\nAlmacenamiento: 50 GB de espacio disponible";
        let p = parse_requirements_html(Some(html));
        assert!(p
            .gpu_text
            .as_deref()
            .is_some_and(|g| g.contains("GTX 1050 Ti")));
        assert_eq!(p.storage_gb, Some(50));
    }
}
