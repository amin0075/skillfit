---
name: stackfit
description: Set up and run stackfit, the CLI that gives each repository only the agent skills, rules, commands, and subagents that fit its stack, from one catalog, for Claude Code, Cursor, and Codex. Use when skills load in repos that don't need them, when syncing skills or rules across several repos or machines, when asked which skills a repo should have or what they cost in context, or when stackfit is mentioned.
license: MIT
---

# stackfit

Every installed skill puts its name and description into every agent session. Install 30 skills globally and a Go service carries your React animation guides on every turn. stackfit keeps one **catalog** of skills and gives each repository only the **packs** its manifests call for, rendered natively for Claude Code, Cursor, and Codex.

Docs: https://github.com/amin0075/stackfit · Package: `npx stackfit` (Node 22+, no dependencies).

## Ground rules for the agent

1. **Measure, then dry-run, then write.** Run `report` and `status` before `sync`, and show the user what will change.
2. **Every project command needs a selector:** `--project <path>`, `--root <dir>`, or `--all` (needs a machine profile). Bare `stackfit status` fails.
3. **Never pass `--force` on your own.** A collision means a file stackfit did not create. Show it and follow `references/troubleshooting.md`.
4. **Never commit, push, or publish** unless asked. Know what is tracked: stackfit excludes exactly the files it generates (via `.git/info/exclude`); files you create in `docs/agent/` (config, repo-owned skills) and the `init` scaffolding are meant to be committed. Check with `git check-ignore -v <file>` (ignored?) and `git ls-files <path>` (tracked?), and tell the user which files to commit.
5. **No personal values in the catalog.** Emails, org names, and tokens go in the catalog's gitignored `.env`, used as `{{env:NAME}}`.
6. **Report numbers honestly.** `report` estimates what loads in every session: skill names + descriptions and always-on rules, per repo, plus the global skill folders that load everywhere regardless. Compare per-repo numbers with today's global cost; if a repo goes up, say so. Never present "every catalog skill in every repo" as the user's previous state.
7. Reuse the user's existing catalog (`stackfit audit` finds it); never create a second one silently.

## Set up stackfit for someone's repos

1. **Baseline.** Note what loads today, per tool: `~/.claude/skills` (Claude Code), `~/.cursor/skills` (Cursor), `~/.codex/skills` (Codex), `~/.agents/skills` (shared): `ls ~/.claude/skills ~/.agents/skills ~/.cursor/skills ~/.codex/skills 2>/dev/null`. Per repo, check `.claude/skills`, `.cursor/skills`, `.cursor/rules`, `.agents/skills`. stackfit writes for all three tools, so a user who only had Claude globals will see Cursor and Codex gain skills they did not have; say so.
2. **Catalog.** `npx stackfit audit` first: if a catalog exists, use it. `No catalog found` (exit 1) is expected on a first run. Choose with the user:
   - **Their own skills only** (they already have skills, or few globals): `npx stackfit catalog init`, then import their skills (recipe 3), skipping any the model doesn't need (recipe 11). Lowest context; nothing new is added.
   - **Curated starter** (they want good skills per stack): `npx stackfit catalog init --starter`, then `npx stackfit refresh --all` (needs git + GitHub). Adds packs they never had: some repos may load more than today.
   - Both: start empty, then copy chosen skills from a starter made in another folder (`catalog init /tmp/sf-starter --starter`).
   Then `npx stackfit audit` (expect no errors).
3. **Preview.**
   ```bash
   npx stackfit report --root ~/code
   npx stackfit status --root ~/code
   ```
   **Record the `Global skills add ...` line now**: it is the baseline, and it disappears once the globals are cleaned up. Compare each repo's `per session` with it. Too high for a repo? Trim with `excludePacks` (recipe 4) or mark long one-off skills manual-only (recipe 7). If `status` stops at `unmanaged collision`, the repo already has its own skills or rules: move them (recipe 3), then preview again.
4. **Write.** `npx stackfit sync --root ~/code`, then `status` again: every repo should say `up to date`. Besides what `status` listed, sync writes `.stackfit.lock.json` and a managed block in `.git/info/exclude` in each repo. Do step 6 right after: until the global copies move, those skills load twice.
5. **Make `--all` work** (optional; for daily `sync --all` / `update --all`). Create `<catalog>/stackfit.local.json`:
   ```json
   { "schemaVersion": 1, "machines": [ { "id": "laptop", "match": { "platform": "darwin" }, "roots": ["~/code"] } ] }
   ```
   `platform` is `darwin`, `linux`, or `win32`. Without `projects`, every Git repo directly under the roots is included.
6. **Clean up globals, carefully.** Global copies of skills that are now in the catalog still load everywhere; removing them is where most savings come from. For each one, with the user's OK:
   - `diff -r ~/.claude/skills/<name> <catalog>/skills/<name>`: keep the user's edits if they differ;
   - make sure it is in a pack that reaches every repo that needs it: an `always` pack (like `core`) for every synced repo, otherwise only repos whose manifests match;
   - `always` means every repo stackfit syncs, not every session: folders outside the roots and non-repo sessions lose the skill. If the user wants it truly everywhere, keep that one global (and out of the catalog's packs, so it doesn't load twice) or add more roots;
   - move rather than delete: `mkdir -p ~/.claude/skills-backup && mv ~/.claude/skills/<name> ~/.claude/skills-backup/`.
7. **Report.** Run `report` again. Per repo: packs and `per session` against the baseline you recorded, per tool. If the absolute numbers are small, say so: the gain may be organisation, not context. Name the files to commit (`docs/agent/...`). Suggest keeping the catalog in a private Git repo; run `git init` / push only if the user agrees.

What `report` looks like (starter catalog, four repos, 31 skills installed globally):

```text
project         skills  skill listings     rules  per session  packs
ingest-worker        2        ~168 tok   ~83 tok     ~251 tok  core
marketing-site      25       ~1.5k tok   ~83 tok    ~1.6k tok  core, react, nextjs, ui, motion
payments-api         5        ~397 tok   ~83 tok     ~480 tok  core, stripe
storefront          24       ~1.5k tok   ~83 tok    ~1.6k tok  core, react, nextjs, e2e, ui, shadcn, stripe

With stackfit: ~4.0k tokens across 4 project(s). Every catalog skill in every repo would be ~8.7k.
Global skills add ~3.0k tokens to every session in every repo, with or without stackfit: ~/.claude/skills (31).
```

Here the Go worker goes from ~3.0k (all globals) to ~251 once the globals are moved into the catalog; the Next.js apps need most packs and save little.

## How it works

```text
~/.stackfit/ (the catalog; keep it in a private Git repo)
  stackfit.json         enabled skills + packs (which skills go where)
  skill-sources.json    upstream source, review date, render overrides per skill
  skills/<name>/        the skills
  rules/ commands/ agents/   shared adapters
  stackfit.local.json   (gitignored) project folders per machine
  .env                  (gitignored) values for {{env:NAME}}

<project>/
  .agents/skills/                   selected skills, one physical copy (Codex reads this)
  .claude/skills, .cursor/skills    links to it
  .claude/rules, .cursor/rules, .claude/commands, .cursor/commands, .claude/agents, .cursor/agents
  .stackfit.lock.json               what stackfit owns here (git-excluded with the rest)
  docs/agent/config.json            optional, tracked: this repo's pack choices
  docs/agent/skills/<name>/         optional, tracked: skills only this repo uses
```

**Packs** decide everything. A pack is `always` (every repo), `detect`ed (dependencies in `package.json`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, or marker files, at the root and in subfolders like `web/`, `apps/*`, `packages/*`), or opt-in. Projects are named by folder. Field reference: `references/configuration.md`.

## Commands

| Command | Use it to |
| --- | --- |
| `catalog init [dir] [--starter]` | Create a catalog (default `~/.stackfit`) |
| `report [--json]` | Per repo: packs, skills, listing + rule tokens per session; global skill folders as baseline |
| `status [--check]` | Dry run; `--check` exits 1 if anything would change |
| `sync` | Write skills, rules, commands, agents into projects |
| `update` | `git pull --ff-only` the catalog, then sync (`--skip-pull` to skip) |
| `init` | Add tracked `AGENTS.md`, `CLAUDE.md`, `docs/agent/` (never overwrites; ask first) |
| `refresh --skill <name>` / `--all` | Re-vendor upstream skills into the catalog |
| `audit [--json]` | Provenance, staleness (180 days), packs, description sizes, cost |

The catalog is found from `--catalog`, `STACKFIT_CATALOG`, the nearest `stackfit.json` above the current folder, or `~/.stackfit`.

## Common requests

| The user says | Do this | Recipe |
| --- | --- | --- |
| "Too many skills" / "what does this repo load?" | `report --project .`, explain the packs column and the global line | 1 |
| "Skill X should apply to every repo" | Put it in an `always` pack (e.g. `core`), sync, then remove the global copy | 3 |
| "Set this up for all my repos" | The setup steps above | 2, 3, 5 |
| "I already have skills in ~/.claude/skills or .cursor/rules" | Move shared ones to the catalog, repo-specific ones to `docs/agent/` | 3 |
| "This repo needs X but not Y" | `packs` / `excludePacks` / `skills` in `docs/agent/config.json` | 4 |
| "Same setup on my work laptop" | Clone the catalog there, add a machine entry, `sync --all` | 5 |
| "Add skill Z from GitHub" | `source` in `skill-sources.json`, then `refresh --skill` | 6 |
| "This upstream skill is too long" / "only when I ask" | `render.frontmatter` override | 7 |
| "Check this in CI" | Validate the repo config and the catalog in CI | 8 |
| "Share with my team" | Catalog in a team repo; everyone runs `update --all` | 9 |

Step-by-step versions: `references/recipes.md`. Every error message and its fix: `references/troubleshooting.md`.

## After any change

Run `npx stackfit status` with the same selector (expect `up to date` for every repo) and `npx stackfit report`. Tell the user what changed per repo, the before/after figures, and which tracked files (`docs/agent/...`) to commit.
