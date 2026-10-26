# My skillfit catalog

Started from the skillfit starter. This folder is yours: keep it in a (private) Git repository.

- `skillfit.json`: enabled skills and packs (which skills reach which repos).
- `skill-sources.json`: where each vendored skill comes from, when you last reviewed it, and sync-time overrides.
- `skills/`: the skills themselves. `skillfit refresh --all` vendors the upstream ones.
- `rules/`, `commands/`, `agents/`: shared adapters rendered for Cursor and Claude Code.
- `skillfit.local.json` (gitignored): where your projects live on each machine. Copy the example.
- `.env` (gitignored): personal values for `{{env:NAME}}` placeholders. Copy `.env.example`.

Add your own skills under `skills/<name>/SKILL.md`, list them in `skillfit.json` and a pack, set `kind: custom` in `skill-sources.json`, then `skillfit audit`.
