# stackfit troubleshooting

Messages are printed as `stackfit: <message>` and exit with code 1.

| Message (start) | Cause | Fix |
| --- | --- | --- |
| `No catalog found` | No `--catalog`, no `STACKFIT_CATALOG`, no `stackfit.json` above the current folder, no `~/.stackfit` | Expected on a first run. `npx stackfit catalog init` (own skills) or `--starter` (curated packs), or point at an existing catalog |
| `<repo>: unmanaged collision at <path>` / `under <path>` | A file stackfit did not create sits where it would write | Show the file to the user. Move it into the catalog or `docs/agent/` (recipes.md, recipe 3) and remove the old copy. Use `--force` only if the user confirms stackfit should take it over |
| `Skill '<name>' is enabled but not in the catalog` | Listed in `stackfit.json` but `skills/<name>/SKILL.md` is missing | `npx stackfit refresh --skill <name>` for external skills, or create the folder |
| `<repo>: unknown pack '<name>'` | Typo in `packs` / `excludePacks` | Use a pack name from `stackfit.json` |
| `<repo>: unknown shared skill '<name>'` | A project's `skills` lists something the catalog does not enable | Enable it in `stackfit.json`, or fix the name |
| `<repo>: repo-owned skill '<name>' conflicts with shared skills` | Same name in `docs/agent/skills/` and the catalog | Rename one, or add the name to `overrides.skills` in `docs/agent/config.json` to let the repo's version win |
| `Configured project '<name>' not found under machine roots` | `stackfit.local.json` lists a folder that is not there | Remove the entry or add the right root |
| `Machine '<id>' roots do not exist` | A root path is wrong on this machine | Fix `roots` for this machine |
| `No stackfit.local.json machine matches <platform> hostname=<host>` | No profile for this computer | Add a machine entry, or use `--root` / `--project` |
| `Choose --project <path>, --root <dir>, or --all` | No project selection given | Add one of them |
| `Catalog has local changes; commit or stash them before update` | `update` pulls with `--ff-only` | Commit or stash in the catalog, or use `sync` |
| `Could not clone <repo>` | No network to GitHub, private repo without token | Check network; set `GITHUB_TOKEN` for private repos |
| `<name> has no recorded upstream source` | `refresh` on a `custom` skill or one without `source` | Add `source` in `skill-sources.json`, or edit the skill directly |
| `warning: <file> uses {{env:NAME}} but NAME is not set` | Placeholder without a value | Add `NAME=...` to the catalog's `.env` (or the shell). The placeholder stays as-is until then |

## Audit warnings worth acting on

- `last reviewed <date> (<n> days ago)`: re-read the skill; refresh, shorten, or archive it, then update `reviewed`.
- `description is <n> chars`: shorten it with `render.frontmatter.description`; claude.ai rejects descriptions over 1024 characters.
- `enabled but in no pack`: it only reaches repos that list it under `skills`; add it to a pack or remove it.
- `external origin is not recorded`: add `source` so it can be refreshed.

## Behaviour that surprises people

- **Skills still load in a repo that should not have them.** Check `~/.claude/skills/` and other global folders: they apply to every repo regardless of stackfit.
- **A Claude rule does not load.** Rules with only a `description` are not rendered for Claude Code. Give them `alwaysApply: true` or `globs:`.
- **Codex ignores rules.** Codex reads `AGENTS.md` and `.agents/skills`, not rule files. Put must-follow rules in `AGENTS.md` or a skill.
- **Nothing in `git status` after a sync.** Expected: generated files are listed in a managed block in `.git/info/exclude`. Files you add under `docs/agent/` do show up and should be committed.
- **After upgrading to 0.1.1, new files appear in `git status` under `.claude/` or `.cursor/`.** Older versions excluded those whole folders; now only generated files are excluded. The newly visible files are the user's own: commit them or add them to `.gitignore`.
- **`status --check` fails in CI on a fresh checkout.** Generated files are never committed, so CI always sees them as missing. Use `sync` (validates config) in project CI and `audit` in catalog CI (recipe 8).
- **Project names look odd (for example `repo` in CI).** stackfit names a project after its folder.
