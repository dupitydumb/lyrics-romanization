# Lyrics Romanization

Adds a synced lyrics panel that shows romanized text for the currently playing track.

## Features

- Player-menu entry in the plugin drawer.
- Live line highlighting synced to playback time.
- Built-in Japanese kana to romaji romanization.
- Built-in Korean Hangul romanization (Revised Romanization-style mapping).
- Japanese kanji transliteration via online fallback (with local cache).
- Optional original line display.
- Local settings persistence (enable/disable, auto-scroll, show original).

## Notes

- This plugin does **not** modify Audion core code.
- Japanese romanization quality is best for kana-based lines.
- Kanji-heavy lines are only partially romanized when kana is present.
- Korean mapping is syllable-based and does not apply advanced pronunciation assimilation rules.
- Online fallback improves kanji lines significantly, but depends on network availability.

## Permissions

- `player:read` — reads current track context.
- `ui:inject` — adds plugin UI in `playerbar:menu`.
- `storage:local` — saves plugin settings.
- `network:fetch` — fetches online Japanese transliteration for kanji lines.
