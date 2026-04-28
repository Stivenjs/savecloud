use std::collections::HashSet;

const SINGLE_NUMBER_WORDS: &[(&str, u32)] = &[
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
    ("octavo", 8),
    ("octava", 8),
    ("ocho", 8),
    ("eight", 8),
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

const TENS_WORDS: &[(&str, u32)] = &[
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

fn word_value(token: &str) -> Option<u32> {
    SINGLE_NUMBER_WORDS
        .iter()
        .find_map(|(word, value)| (*word == token).then_some(*value))
        .or_else(|| {
            TENS_WORDS
                .iter()
                .find_map(|(word, value)| (*word == token).then_some(*value))
        })
        .or_else(|| {
            FUSED_TWENTIES
                .iter()
                .find_map(|(word, value)| (*word == token).then_some(*value))
        })
}

fn parse_number_tokens(tokens: &[&str], idx: usize) -> Option<(u32, usize)> {
    let current = *tokens.get(idx)?;

    if let Some(value) = FUSED_TWENTIES
        .iter()
        .find_map(|(word, value)| (*word == current).then_some(*value))
    {
        return Some((value, 1));
    }

    if let Some(value) = SINGLE_NUMBER_WORDS
        .iter()
        .find_map(|(word, value)| (*word == current).then_some(*value))
    {
        return Some((value, 1));
    }

    if let Some(tens) = TENS_WORDS
        .iter()
        .find_map(|(word, value)| (*word == current).then_some(*value))
    {
        let and_token = tokens.get(idx + 1).copied();
        let unit_token = tokens.get(idx + 2).copied();
        if and_token == Some("y") {
            if let Some(unit) = unit_token.and_then(word_value) {
                if (1..=9).contains(&unit) {
                    return Some((tens + unit, 3));
                }
            }
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

    let mut variants: HashSet<String> = HashSet::new();
    let mut replaced_tokens = Vec::with_capacity(tokens.len());
    let mut idx = 0usize;
    let mut changed = false;

    while idx < tokens.len() {
        if let Some((number, consumed)) = parse_number_tokens(&tokens, idx) {
            replaced_tokens.push(number.to_string());
            idx += consumed;
            changed = true;
            continue;
        }
        replaced_tokens.push(tokens[idx].to_string());
        idx += 1;
    }

    if changed {
        variants.insert(replaced_tokens.join(" "));
    }

    let mut all_single_replacements = Vec::with_capacity(tokens.len());
    let mut has_single_replacement = false;
    for token in &tokens {
        if let Some(value) = word_value(token) {
            all_single_replacements.push(value.to_string());
            has_single_replacement = true;
        } else {
            all_single_replacements.push((*token).to_string());
        }
    }
    if has_single_replacement {
        variants.insert(all_single_replacements.join(" "));
    }

    let mut out: Vec<String> = variants.into_iter().collect();
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::expand_numeric_variants;

    #[test]
    fn expands_basic_spanish_cardinal() {
        let variants = expand_numeric_variants("resident evil cuatro");
        assert!(variants.contains(&"resident evil 4".to_string()));
    }

    #[test]
    fn expands_spanish_compound_number() {
        let variants = expand_numeric_variants("fifa treinta y dos");
        assert!(variants.contains(&"fifa 32".to_string()));
    }

    #[test]
    fn expands_fused_twenties() {
        let variants = expand_numeric_variants("fifa veinticuatro");
        assert!(variants.contains(&"fifa 24".to_string()));
    }

    #[test]
    fn expands_mixed_language_words() {
        let variants = expand_numeric_variants("doom four");
        assert!(variants.contains(&"doom 4".to_string()));
    }
}
