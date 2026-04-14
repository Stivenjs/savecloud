use regex::Regex;
use std::sync::LazyLock;

static VRAM_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s*(?:with|con)\s+\d+\s*gb\s*vram\s*").expect("vram tail")
});

static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("spaces"));

fn norm(s: &str) -> String {
    SPACES.replace_all(s.trim(), " ").to_string().to_lowercase()
}

fn strip_vram_phrases(s: &str) -> String {
    VRAM_TAIL.replace_all(s, " ").trim().to_string()
}

pub fn user_gpu_matches_listing(user_gpu: &str, gpu_section: &str) -> bool {
    let u = norm(user_gpu);
    if u.len() < 3 {
        return false;
    }

    for alt in gpu_section.split('/') {
        let cleaned = strip_vram_phrases(alt);
        let a = norm(&cleaned);
        if a.len() < 6 {
            continue;
        }
        if u.contains(&a) || a.contains(&u) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_one_of_slash_alternatives() {
        let req = "AMD Radeon RX 560 with 4GB VRAM / NVIDIA GeForce GTX 1050 Ti with 4GB VRAM";
        assert!(user_gpu_matches_listing(
            "NVIDIA GeForce GTX 1050 Ti with 4GB VRAM",
            req
        ));
        assert!(user_gpu_matches_listing("NVIDIA GeForce GTX 1050 Ti", req));
        assert!(user_gpu_matches_listing("AMD Radeon RX 560", req));
    }

    #[test]
    fn no_match_different_tier() {
        let req = "AMD Radeon RX 560 / NVIDIA GeForce GTX 1050 Ti";
        assert!(!user_gpu_matches_listing("NVIDIA GeForce RTX 4090", req));
    }
}
