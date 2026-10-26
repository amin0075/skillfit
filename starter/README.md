# My stackfit catalog

Started from the stackfit starter. This folder is yours: keep it in a (private) Git repository.

- `stackfit.json`: enabled skills and packs (which skills reach which repos).
- `skill-sources.json`: where each vendored skill comes from, when you last reviewed it, and sync-time overrides.
- `skills/`: the skills themselves. `stackfit refresh --all` vendors the upstream ones.
- `rules/`, `commands/`, `agents/`: shared adapters rendered for Cursor and Claude Code.
- `stackfit.local.json` (gitignored): where your projects live on each machine. Copy the example.
- `.env` (gitignored): personal values for `{{env:NAME}}` placeholders. Copy `.env.example`.

Add your own skills under `skills/<name>/SKILL.md`, list them in `stackfit.json` and a pack, set `kind: custom` in `skill-sources.json`, then `stackfit audit`.
