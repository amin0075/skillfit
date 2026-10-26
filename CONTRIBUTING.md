# Contributing

Thanks for helping. stackfit has no runtime dependencies and needs Node 22+.

```bash
npm test
```

## Layout

- `bin/stackfit.mjs`: argument parsing and command dispatch.
- `src/catalog.mjs`: finding the catalog, `.env` loading, `{{env:NAME}}`.
- `src/detect.mjs`: manifest readers and pack selection.
- `src/render.mjs`: per-agent transforms (Cursor `.mdc` → Claude `paths:` rules, manual-only commands, agents).
- `src/sync.mjs`: plan → apply with the lock, collision checks, pruning, links.
- `src/report.mjs`, `src/audit.mjs`, `src/refresh.mjs`, `src/scaffold.mjs`: the other commands.
- `starter/`: the catalog `catalog init --starter` copies. Upstream skills are listed in `skill-sources.json`, never committed here.

## Good first contributions

- A manifest reader in `src/detect.mjs` (Gemfile, pom.xml, build.gradle, pubspec.yaml), with a test.
- A new agent target (GitHub Copilot, Gemini CLI, Windsurf) in `src/render.mjs` + `src/sync.mjs`.
- A starter pack built from a maintained upstream skill, with `reviewed` set to today.

Every behavior change needs a test in `test/`. Keep skills out of this repo except the first-party ones in `starter/skills/`.
