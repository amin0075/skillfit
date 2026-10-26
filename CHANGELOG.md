# Changelog

## 0.1.1

- Git exclude now lists only the files stackfit generates (plus `.agents/` and the two skill links) in one managed block. Earlier versions excluded the whole `.claude/` and `.cursor/` folders, which hid a user's own files there (for example `.claude/settings.json`) from git. The next sync replaces the old lines; your own lines in `.git/info/exclude` are kept.
- New: `skills/stackfit`, an agent skill that teaches Claude Code, Cursor, and Codex how to use stackfit (`npx skills add amin0075/stackfit`).

## 0.1.0

- First release.
