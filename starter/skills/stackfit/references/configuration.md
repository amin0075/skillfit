# stackfit configuration reference

All files are JSON. Schemas: `https://unpkg.com/stackfit/schemas/<name>.schema.json`.

## stackfit.json (catalog registry)

```json
{
  "$schema": "https://unpkg.com/stackfit/schemas/stackfit.schema.json",
  "schemaVersion": 3,
  "projectConfigPath": "docs/agent/config.json",
  "skills": ["grilling", "next-server-security", "shadcn", "my-checkout-rules"],
  "packs": {
    "core":   { "description": "Every repo.", "always": true, "skills": ["grilling"] },
    "nextjs": { "detect": { "dependencies": ["next"] }, "skills": ["next-server-security"] },
    "shadcn": { "detect": { "files": ["components.json"] }, "skills": ["shadcn"] },
    "shop":   { "description": "Opt-in.", "skills": ["my-checkout-rules"] }
  },
  "adapters": {
    "agents": ["reviewer.md"],
    "commands": ["handoff.md"],
    "rules": ["defaults.mdc"]
  }
}
```

- `skills`: the enabled catalog. A skill reaches a project only through a pack or a project's `skills` list.
- `packs.<name>.always`: every project gets it; cannot be excluded.
- `packs.<name>.detect.dependencies`: dependency names (case-insensitive) from `package.json` (all dependency fields), `requirements*.txt`, `pyproject.toml`, `go.mod` (module paths), `Cargo.toml`, `composer.json`.
- `packs.<name>.detect.files`: file or folder names present at the root, a top-level folder, or one level below it (`components.json`, `go.mod`, `release-please-config.json`).
- A pack with neither `always` nor `detect` is opt-in.
- `adapters`: files under `agents/`, `commands/`, `rules/` synced to every project.

## skill-sources.json (provenance and overrides)

```json
{
  "schemaVersion": 2,
  "skills": {
    "my-checkout-rules": { "kind": "custom", "reviewed": "2026-10-26" },
    "shadcn": {
      "kind": "external",
      "source": { "repository": "https://github.com/shadcn-ui/ui.git", "path": "skills/shadcn" },
      "reviewed": "2026-10-26",
      "render": {
        "frontmatter": { "description": "Add, search, and style shadcn/ui components. Use with components.json." },
        "exclude": ["evals/evals.json"]
      }
    }
  }
}
```

- `kind`: `custom` (owned in the catalog) or `external` (vendored, refreshable).
- `source`: Git repository + folder holding `SKILL.md`. Required for `refresh`.
- `reviewed`: last date someone checked the skill is current and worth its context. `audit` warns after 180 days.
- `render.frontmatter`: replaces top-level SKILL.md frontmatter keys at sync time (`null` removes a key). Survives `refresh`. Typical: shorter `description`, `"disable-model-invocation": true`, `name` when the upstream folder name differs.
- `render.exclude`: skill-relative files never copied into projects (evals, READMEs, compiled `AGENTS.md` duplicates).
- `skill-sources.lock.json` (written by `refresh`): upstream commit of each vendored skill.

## docs/agent/config.json (per project, tracked)

```json
{
  "schemaVersion": 1,
  "packs": ["motion"],
  "excludePacks": ["stripe"],
  "skills": ["ui-ux-pro-max"],
  "disabledSharedSkills": ["ponytail"],
  "detect": true,
  "overrides": { "skills": [], "agents": [], "commands": [], "rules": [] }
}
```

- `packs`: add packs (opt-in ones, or ones detection missed).
- `excludePacks`: drop detected packs (`core`/`always` packs stay).
- `skills`: add single catalog skills without their pack.
- `disabledSharedSkills`: remove single skills, applied last.
- `detect: false`: only `always` packs plus what is listed.
- `overrides.<kind>`: names of repo-owned components allowed to replace shared ones with the same name.

Repo-owned components (tracked in the project, synced next to shared ones):
- `docs/agent/skills/<name>/SKILL.md`
- `docs/agent/rules/<name>.md`: add `globs:` (becomes Claude `paths:`) or `alwaysApply: true`; otherwise it stays Cursor-only and is routed through `AGENTS.md`.
- `docs/agent/commands/<name>.md`, `docs/agent/agents/<name>.md`

## stackfit.local.json (per machine, gitignored)

```json
{
  "schemaVersion": 1,
  "machines": [
    {
      "id": "mac",
      "match": { "platform": "darwin" },
      "roots": ["~/code", "~/work"],
      "projects": [
        "shop-web",
        { "name": "client-site", "scaffold": false, "packs": ["motion"], "excludePacks": ["stripe"] }
      ]
    },
    { "id": "work-pc", "match": { "platform": "win32", "hostname": "WORK-PC" }, "roots": ["C:/dev"] }
  ]
}
```

- `match.platform`: `darwin`, `win32`, or `linux`. `match.hostname` (optional) wins over platform-only entries.
- `roots`: absolute, `~/`, or relative to the catalog.
- `projects` (optional): only these folders under the roots. Without it, every Git repo directly under a root is synced.
- `scaffold: false`: adapter-only. stackfit never reads or creates the repo's `docs/agent/`, and keeps `CLAUDE.md` and `docs/agent/` git-excluded. Put that repo's pack choices here instead.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `STACKFIT_CATALOG` | Catalog folder, so stackfit works from anywhere |
| `STACKFIT_LOCAL_CONFIG` | Another machine-profile file |
| `GITHUB_TOKEN` | Private repositories for `refresh` (sent as a header, never stored) |
| Anything else | Fills `{{env:NAME}}` in commands, rules, and agents |

Read from the shell, `./.env`, then the catalog's `.env`; shell values win. A missing variable prints a warning and leaves the placeholder.

## What gets written where

| Catalog item | Claude Code | Cursor | Codex |
| --- | --- | --- | --- |
| Skills | `.claude/skills` → `.agents/skills` | `.cursor/skills` → `.agents/skills` | `.agents/skills` |
| `alwaysApply` rule | `.claude/rules/<n>.md` | `.cursor/rules/<n>.mdc` | not auto-loaded; point to it from `AGENTS.md` |
| `globs` rule | `.claude/rules/<n>.md` with `paths:` | `.cursor/rules/<n>.mdc` | not auto-loaded |
| Description-only rule | not rendered | `.cursor/rules/<n>.mdc` | not auto-loaded |
| Command | `.claude/commands/<n>.md` (manual-only) | `.cursor/commands/<n>.md` | use a skill |
| Agent | `.claude/agents/<n>.md` (`model: inherit`) | `.cursor/agents/<n>.md` | n/a |

Links are symlinks on macOS/Linux and directory junctions on Windows (no admin rights needed).

Git: stackfit lists exactly the files it generates (plus `.agents/` and the two skill links) in a managed block in `.git/info/exclude`, so they never show up in `git status`, while the user's own files in `.claude/` or `.cursor/` stay visible. Files in `docs/agent/` are not excluded: commit them.
