# stackfit recipes

Each recipe lists the commands and files in order. Always run `status` before `sync` and show the user the result.

## 1. See what a repo loads, and why

```bash
npx stackfit report --project .
npx stackfit report --root ~/code          # every Git repo directly under ~/code
npx stackfit report --all --json           # machine profile, for scripts
```

Explain each column:
- `skills` = skills this repo gets (catalog packs + its own `docs/agent/skills`).
- `skill listings` = estimated tokens of those skills' names + descriptions, loaded in every session (about 4 characters per token). Bodies load only when a skill is used; manual-only skills count 0.
- `rules` = always-on rules (Claude `.claude/rules` without `paths:`), loaded in full every session.
- `per session` = the two together.
- `packs` = why: each pack was `always`, detected, or requested.
- The `Global skills add ...` line is what `~/.claude/skills` and similar folders cost in every repo regardless of stackfit (`No global skill folders found` when there are none). Compare `per session` with it: that is the honest before/after once global copies are moved into the catalog. Note it before cleaning up globals.

If a pack looks wrong, find the signal: `grep -r '"<dependency>"' --include=package.json .` (or the matching manifest), or check for the marker file. Fix with recipe 4.

## 2. First-time setup

Follow "Set up stackfit for someone's repos" in SKILL.md (baseline → catalog → preview → write → machine profile → clean up globals → report). Extras:

- Keep the catalog in a private Git repo (`git init` in it, push it) so other machines and teammates can use it (recipes 5, 9).
- A catalog outside `~/.stackfit` is found via `--catalog <dir>`, `STACKFIT_CATALOG` (shell or `./.env`), or by running stackfit inside it.
- `npx stackfit init --project <repo>` adds a tracked `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), and `docs/agent/` pages for repo-specific context. It never overwrites, but ask first: these are files the user will commit.

## 3. Migrate existing skills and rules into stackfit

Typical starting points: `~/.claude/skills/`, a repo's `.claude/skills/` or `.cursor/rules/`, an `.agents/skills/` folder from `npx skills add`.

1. Sort each item:
   - Useful in many repos → catalog: `<catalog>/skills/<name>/SKILL.md` (or `rules/<name>.mdc`).
   - Specific to one repo → that repo: `docs/agent/skills/<name>/SKILL.md` (or `docs/agent/rules/<name>.md`).
   - Generic knowledge the model already has → suggest dropping it.
2. For catalog skills, copy the folder into `<catalog>/skills/<name>/` (copy, don't move: the global copy is handled by setup step 6), then register it:
   - add the name to `skills` in `stackfit.json` and to a pack. Pick the pack by who needs it: an `always` pack (`core`) for every repo; a detect pack keyed on the base dependency for stack skills (`react` also covers Next.js repos, since they depend on `react`; use `next` only for Next-specific skills); an opt-in pack for occasional ones;
   - in `skill-sources.json`: `{ "kind": "custom", "reviewed": "<today>" }` for the user's own skills. For one that came from GitHub, use `"kind": "external"` with its real `source` only if you can confirm it (the skill's README, metadata, or the user); never guess a repository path. If unknown, record it as `custom` with a `"note"` saying where it came from;
   - `npx stackfit audit`.
3. Move or delete only the items you migrated, one at a time, after the user confirms:
   ```bash
   mkdir -p <repo>/docs/agent/skills
   mv <repo>/.claude/skills/<name> <repo>/docs/agent/skills/<name>   # repo-specific skill
   rmdir <repo>/.claude/skills 2>/dev/null                          # only if now empty
   ```
   If `.claude/skills` was tracked in git, the user commits the move. Leave anything you did not migrate in place.
4. `npx stackfit status --project <repo>`, then `sync`.

Real example of the collision that step 3 prevents:

```text
stackfit: shop-web: unmanaged collision under .claude/skills: .claude/skills/my-own-skill/SKILL.md
```

After moving `my-own-skill` to `shop-web/docs/agent/skills/my-own-skill/`, the same sync succeeds and the skill appears next to the catalog ones in `.agents/skills/`.

Global skills in `~/.claude/skills/` still load in every repo. Once they are in the catalog, follow step 6 of the setup in SKILL.md (diff, check the pack reaches every repo that needs it, move to a backup folder). To keep a skill everywhere, put it in an `always` pack such as `core`.

## 4. Change what one repo gets

Tracked, shared with the team (`<repo>/docs/agent/config.json`):

```json
{ "schemaVersion": 1, "packs": ["motion"], "excludePacks": ["stripe"], "skills": ["ui-ux-pro-max"] }
```

Local only, for repos you should not touch (on the project entry in `stackfit.local.json`):

```json
{ "name": "client-site", "scaffold": false, "packs": ["motion"], "excludePacks": ["stripe"] }
```

Then `status` (removed skills show as `delete`, and their folders are pruned) and `sync`.

## 5. One or several machines

`stackfit.local.json` lives next to `stackfit.json` and is gitignored, so each computer has its own. Minimal, one machine:

```json
{ "schemaVersion": 1, "machines": [ { "id": "laptop", "match": { "platform": "darwin" }, "roots": ["~/code"] } ] }
```

- `platform`: `darwin`, `linux`, or `win32`. Add `"hostname": "WORK-PC"` to tell two machines with the same platform apart.
- Without `projects`, every Git repo directly under `roots` is included. With `projects`, only those folders (and each entry may carry `packs`, `excludePacks`, `skills`, `scaffold: false`).
- Don't copy `stackfit.local.example.json` unchanged: its sample project names won't exist and cause `Configured project ... not found`.

Several machines: put the catalog in a private Git repo, clone it on each, give each its own `stackfit.local.json`, then `npx stackfit sync --all`. Later `npx stackfit update --all` pulls the catalog and syncs (it refuses while the catalog has uncommitted changes).

## 6. Add a skill from GitHub

1. Find the folder holding its `SKILL.md`, for example `skills/react-best-practices` in `https://github.com/vercel-labs/agent-skills.git`.
2. In `skill-sources.json`:
   ```json
   "vercel-react-best-practices": {
     "kind": "external",
     "source": { "repository": "https://github.com/vercel-labs/agent-skills.git", "path": "skills/react-best-practices" },
     "reviewed": "2026-10-26",
     "render": { "exclude": ["AGENTS.md", "README.md", "metadata.json"] }
   }
   ```
   If the upstream frontmatter `name` differs from the folder name you chose, add `"render": { "frontmatter": { "name": "<your-folder-name>" } }`.
3. Add the name to `skills` and to a pack in `stackfit.json`.
4. `npx stackfit refresh --skill vercel-react-best-practices`, then `audit`, then review the vendored files with the user before syncing.

Private repositories: set `GITHUB_TOKEN` in the shell or the catalog's `.env`.

## 7. Tame a long or noisy upstream skill

In `skill-sources.json`, under that skill:

```json
"render": {
  "frontmatter": {
    "description": "One line on what it does. Use when <specific trigger>.",
    "disable-model-invocation": true
  },
  "exclude": ["evals/evals.json"]
}
```

- Shorter `description`: cheaper in every session; keep the trigger words.
- `disable-model-invocation: true`: costs nothing until the user calls it by name. Good for adoptions, migrations, releases.
- Overrides apply at sync time, so `refresh` never undoes them. Check the effect with `npx stackfit audit` (cost per pack).

## 8. Check it in CI

Generated files are never committed, so a fresh CI checkout has none of them, and `status --check` would always report changes there. In CI, check what *is* committed instead:

- **In each project's CI:** run `sync` against the pinned catalog. It exits 1 on real problems: an unknown pack or skill in `docs/agent/config.json`, a repo-owned skill clashing with a shared one, a malformed config.
- **In the catalog's CI:** run `audit`. It exits 1 on unknown or unvendored skills and broken adapters, and warns on stale or oversized ones.

GitHub Actions, project repo with a private catalog (store a read-only token as `CATALOG_TOKEN`):

```yaml
- uses: actions/checkout@v5
- uses: actions/checkout@v5
  with:
    repository: your-org/agent-catalog
    ref: v3                      # pin a tag or commit so builds are reproducible
    token: ${{ secrets.CATALOG_TOKEN }}
    path: .stackfit-catalog
- uses: actions/setup-node@v5
  with: { node-version: 22 }
- run: npx stackfit sync --project . --catalog .stackfit-catalog --quiet
```

Catalog repo:

```yaml
- uses: actions/checkout@v5
- uses: actions/setup-node@v5
  with: { node-version: 22 }
- run: npx stackfit audit --catalog .
```

`status --check` is for a developer's machine (for example before a release, or in a pre-push hook): exit 1 means the local generated files no longer match the catalog; `npx stackfit sync --project .` fixes it.

## 9. A team catalog

- One Git repo for the catalog; reviewers approve skill changes like code.
- Personal values stay out: use `{{env:NAME}}` in commands, rules, and agents, and document the names in the catalog's `.env.example`.
- `npx stackfit audit` in the catalog's CI catches unknown skills, missing sources, oversized descriptions, and skills not reviewed for 180 days.
- Everyone runs `npx stackfit update --all` to pull and sync.

## 10. Keep it lean over time

Quarterly, or when `audit` flags it:
1. `npx stackfit refresh --all` and review the diff.
2. Read anything `audit` calls stale; archive what no longer earns its context (move it to `skills/_archive/`, remove it from `stackfit.json` and `skill-sources.json`).
3. Update `reviewed` dates.
4. `npx stackfit report --all` and compare with last time.

## 11. Write a catalog skill that earns its place

- Only keep what a frontier model would otherwise get wrong: your conventions, a non-obvious workflow, version-specific framework behaviour, a tool's exact CLI. Generic knowledge costs context and adds nothing.
- `description` is what every session pays for: say what it does and exactly when to use it, in one or two sentences.
- Keep `SKILL.md` short; move long material into files it links to (loaded only when needed).
- Mark one-off workflows (migrations, adoptions, releases) `disable-model-invocation: true` so they cost nothing until called.
- Register it: `skills` + a pack in `stackfit.json`, `{ "kind": "custom", "reviewed": "<today>" }` in `skill-sources.json`, then `npx stackfit audit`.
