use std::collections::HashSet;

const SINGLES: &[(&str, u32)] = &[
    ("cero", 0),
    ("zero", 0),
    ("uno", 1),
    ("un", 1),
    ("una", 1),
    ("one", 1),
    ("primer", 1),
    ("primero", 1),
    ("primera", 1),
    ("dos", 2),
    ("two", 2),
    ("segundo", 2),
    ("segunda", 2),
    ("tres", 3),
    ("three", 3),
    ("tercero", 3),
    ("tercera", 3),
    ("cuatro", 4),
    ("four", 4),
    ("cuarto", 4),
    ("cuarta", 4),
    ("cinco", 5),
    ("five", 5),
    ("quinto", 5),
    ("quinta", 5),
    ("seis", 6),
    ("six", 6),
    ("sexto", 6),
    ("sexta", 6),
    ("siete", 7),
    ("seven", 7),
    ("septimo", 7),
    ("septima", 7),
    ("ocho", 8),
    ("eight", 8),
    ("octavo", 8),
    ("octava", 8),
    ("nueve", 9),
    ("nine", 9),
    ("noveno", 9),
    ("novena", 9),
    ("diez", 10),
    ("ten", 10),
    ("decimo", 10),
    ("decima", 10),
    ("once", 11),
    ("eleven", 11),
    ("doce", 12),
    ("twelve", 12),
    ("trece", 13),
    ("catorce", 14),
    ("quince", 15),
    ("dieciseis", 16),
    ("diecisiete", 17),
    ("dieciocho", 18),
    ("diecinueve", 19),
    ("veinte", 20),
];

const TENS: &[(&str, u32)] = &[
    ("treinta", 30),
    ("cuarenta", 40),
    ("cincuenta", 50),
    ("sesenta", 60),
    ("setenta", 70),
    ("ochenta", 80),
    ("noventa", 90),
];

const FUSED_TWENTIES: &[(&str, u32)] = &[
    ("veintiuno", 21),
    ("veintiun", 21),
    ("veintiuna", 21),
    ("veintidos", 22),
    ("veintitres", 23),
    ("veinticuatro", 24),
    ("veinticinco", 25),
    ("veintiseis", 26),
    ("veintisiete", 27),
    ("veintiocho", 28),
    ("veintinueve", 29),
];

fn lookup(table: &[(&str, u32)], token: &str) -> Option<u32> {
    table
        .iter()
        .find_map(|&(word, val)| (word == token).then_some(val))
}

fn word_value(token: &str) -> Option<u32> {
    lookup(FUSED_TWENTIES, token)
        .or_else(|| lookup(SINGLES, token))
        .or_else(|| lookup(TENS, token))
}

fn parse_at(tokens: &[&str], idx: usize) -> Option<(u32, usize)> {
    let current = *tokens.get(idx)?;

    if let Some(v) = lookup(FUSED_TWENTIES, current) {
        return Some((v, 1));
    }

    if let Some(v) = lookup(SINGLES, current) {
        return Some((v, 1));
    }

    if let Some(tens) = lookup(TENS, current) {
        let compound = matches!(
            (tokens.get(idx + 1).copied(), tokens.get(idx + 2).copied()),
            (Some("y"), Some(unit)) if matches!(word_value(unit), Some(1..=9))
        );
        if compound {
            let unit = word_value(tokens[idx + 2]).unwrap();
            return Some((tens + unit, 3));
        }
        return Some((tens, 1));
    }

    None
}

pub fn expand_numeric_variants(input: &str) -> Vec<String> {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut greedy: Vec<String> = Vec::with_capacity(tokens.len());
    let mut idx = 0;
    let mut changed = false;

    while idx < tokens.len() {
        if let Some((value, consumed)) = parse_at(&tokens, idx) {
            greedy.push(value.to_string());
            idx += consumed;
            changed = true;
        } else {
            greedy.push(tokens[idx].to_string());
            idx += 1;
        }
    }

    if !changed {
        return Vec::new();
    }

    let mut variants: HashSet<String> = HashSet::new();
    variants.insert(greedy.join(" "));

    let token_pass: Vec<String> = tokens
        .iter()
        .map(|&t| word_value(t).map_or_else(|| t.to_string(), |v| v.to_string()))
        .collect();
    variants.insert(token_pass.join(" "));

    let mut out: Vec<String> = variants.into_iter().collect();
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::expand_numeric_variants;

    #[test]
    fn basic_spanish_cardinal() {
        assert!(expand_numeric_variants("resident evil cuatro")
            .contains(&"resident evil 4".to_string()));
    }

    #[test]
    fn compound_tens_and_units() {
        assert!(expand_numeric_variants("fifa treinta y dos").contains(&"fifa 32".to_string()));
    }

    #[test]
    fn fused_twenties() {
        assert!(expand_numeric_variants("fifa veinticuatro").contains(&"fifa 24".to_string()));
    }

    #[test]
    fn english_cardinal() {
        assert!(expand_numeric_variants("doom four").contains(&"doom 4".to_string()));
    }

    #[test]
    fn no_number_words_returns_empty() {
        assert!(expand_numeric_variants("doom eternal").is_empty());
    }
}
