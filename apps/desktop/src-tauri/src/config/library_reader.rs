use super::models::ConfiguredGame;
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use std::fmt;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

struct LibrarySeed<'a> {
    game_id: &'a str,
}

impl<'de> DeserializeSeed<'de> for LibrarySeed<'_> {
    type Value = Option<ConfiguredGame>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(LibraryVisitor { game_id: self.game_id })
    }
}

struct LibraryVisitor<'a> {
    game_id: &'a str,
}

impl<'de> Visitor<'de> for LibraryVisitor<'_> {
    type Value = Option<ConfiguredGame>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a game library object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut game = None;
        while let Some(key) = map.next_key::<String>()? {
            if key == "games" {
                game = map.next_value_seed(GamesSeed { game_id: self.game_id })?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(game)
    }
}

struct GamesSeed<'a> {
    game_id: &'a str,
}

impl<'de> DeserializeSeed<'de> for GamesSeed<'_> {
    type Value = Option<ConfiguredGame>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(GamesVisitor { game_id: self.game_id })
    }
}

struct GamesVisitor<'a> {
    game_id: &'a str,
}

impl<'de> Visitor<'de> for GamesVisitor<'_> {
    type Value = Option<ConfiguredGame>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an array of configured games")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut found = None;
        while let Some(game) = seq.next_element::<ConfiguredGame>()? {
            if found.is_none() && game.id.eq_ignore_ascii_case(self.game_id) {
                found = Some(game);
            }
        }
        Ok(found)
    }
}

/// Reads one configured game from the legacy JSON library without building a `GameLibrary`.
pub(super) fn load_game(path: &Path, game_id: &str) -> Result<Option<ConfiguredGame>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("No se pudo leer la biblioteca: {error}")),
    };

    let mut deserializer = serde_json::Deserializer::from_reader(BufReader::new(file));
    let game = LibrarySeed { game_id }
        .deserialize(&mut deserializer)
        .map_err(|error| format!("No se pudo interpretar la biblioteca: {error}"))?;
    deserializer
        .end()
        .map_err(|error| format!("No se pudo interpretar la biblioteca: {error}"))?;

    Ok(game)
}
