# skillfit

**Your agent loads every skill in every repo. It needs a handful.**

skillfit keeps one catalog of agent skills, rules, commands, and subagents, and gives each repository only what fits its stack: Next.js skills where there is `next`, Stripe skills where there is `stripe`, nothing for design in a Go service. It renders them for **Claude Code, Cursor, and Codex**, across every project on your machine, in one command.

![skillfit demo](https://raw.githubusercontent.com/amin0075/skillfit/main/media/demo.gif)

```bash
npx skillfit catalog init --starter   # a catalog in ~/.skillfit with curated packs
npx skillfit refresh --all            # vendor the upstream skills (Vercel, shadcn, Stripe, ...)
npx skillfit report --root ~/code     # what each repo would load, and what you save
npx skillfit sync --root ~/code       # write it
```

## Why

Every installed skill puts its name and description into every agent session, so the agent knows it exists. Install 40 skills globally and a Go service pays for your React animation guides on every turn. Copy skills into each repo by hand and they drift, go stale, and lose your edits on the next update.

skillfit treats agent context like a dependency:

- **Packs, detected per repo.** Skills belong to packs. A pack is selected when the repo's manifests mention a dependency or contain a file: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, at the root and in subfolders like `web/`, `apps/*`, `packages/*`.
- **One catalog, every repo.** Machine profiles list your project folders on each computer (Mac at home, Windows at work). `skillfit update --all` pulls the catalog and syncs them all.
- **Measured.** `skillfit report` shows the always-loaded cost per repo; `skillfit audit` flags stale, unsourced, and oversized skills.
- **Upstream skills without losing your edits.** Vendor skills from GitHub with `refresh`; shorten a description, make a skill manual-only, or drop files with `render` overrides that survive every refresh.
- **Native for each agent.** Claude Code gets `.claude/skills`, `.claude/rules` (glob rules become `paths:`), manual-only commands, and subagents. Cursor gets `.cursor/skills`, `.mdc` rules, commands, and agents. Codex reads `.agents/skills`. One physical copy, symlinked (junctions on Windows, no admin needed).
- **Safe.** Generated files are tracked in a lock and excluded from Git locally. skillfit never overwrites a file it did not create, and never touches files your repo owns.

## Example

```text
$ skillfit report --root ~/code      # the starter catalog, four sample repos
project         skills  always-loaded  vs. everything  packs
ingest-worker     2/31       ~168 tok            -92%  core
marketing-site   25/31      ~1.5k tok            -27%  core, react, nextjs, ui, motion
payments-api      5/31       ~397 tok            -81%  core, stripe
storefront       24/31      ~1.5k tok            -27%  core, react, nextjs, e2e, ui, shadcn, stripe

4 projects load ~3.6k tokens of skill listings in total, instead of ~8.4k if every skill went everywhere (-57%).
```

## How it works

```text
~/.skillfit/                        your catalog (keep it in a private Git repo)
  skillfit.json                     enabled skills + packs
  skill-sources.json                where each skill comes from, review dates, render overrides
  skills/<name>/SKILL.md            the skills
  rules/  commands/  agents/        shared adapters
  skillfit.local.json               (gitignored) your project folders per machine
  .env                              (gitignored) values for {{env:NAME}} placeholders

<project>/
  .agents/skills/                   the selected skills (one physical copy)
  .claude/skills  .cursor/skills    symlinks to it
  .claude/rules/*.md  .cursor/rules/*.mdc
  .claude/commands  .cursor/commands
  .claude/agents  .cursor/agents
  .skillfit.lock.json               what skillfit owns here
  docs/agent/config.json            (optional, tracked) this repo's pack choices
```

### Packs

```json
{
  "schemaVersion": 3,
  "skills": ["grilling", "next-server-security", "next-dev-loop", "shadcn"],
  "packs": {
    "core":   { "always": true, "skills": ["grilling"] },
    "nextjs": { "detect": { "dependencies": ["next"] }, "skills": ["next-server-security", "next-dev-loop"] },
    "shadcn": { "detect": { "files": ["components.json"] }, "skills": ["shadcn"] },
    "python": { "detect": { "dependencies": ["django", "fastapi"] }, "skills": [] }
  }
}
```

`always` packs go everywhere; `detect` packs are chosen automatically; packs with neither are opt-in. A repository adjusts its own selection in `docs/agent/config.json`:

```json
{ "schemaVersion": 1, "packs": ["motion"], "excludePacks": ["stripe"], "skills": ["ui-ux-pro-max"] }
```

Or, without touching the repo, on its entry in `skillfit.local.json`.

### Machines

```json
{
  "schemaVersion": 1,
  "machines": [
    { "id": "mac", "match": { "platform": "darwin" }, "roots": ["~/code"], "projects": ["storefront", { "name": "client-site", "scaffold": false, "packs": ["motion"] }] },
    { "id": "work", "match": { "platform": "win32", "hostname": "WORK-PC" }, "roots": ["C:/dev"] }
  ]
}
```

Then `skillfit sync --all` on each machine. Without `projects`, every Git repo under `roots` is synced.

### Upstream skills and overrides

```json
"shadcn": {
  "kind": "external",
  "source": { "repository": "https://github.com/shadcn-ui/ui.git", "path": "skills/shadcn" },
  "reviewed": "2026-10-26",
  "render": {
    "frontmatter": { "description": "Add, search, and style shadcn/ui components. Use with components.json." },
    "exclude": ["evals/evals.json"]
  }
}
```

`skillfit refresh --skill shadcn` replaces the vendored copy and records the upstream commit in `skill-sources.lock.json`. Your `render` overrides apply at sync time, so they survive. Set `"disable-model-invocation": true` on long one-off workflows (migrations, adoptions) so they cost nothing until you call them.

### Personal values

Commands, rules, and agents can contain `{{env:NAME}}`. skillfit fills them at sync time from your shell or the catalog's gitignored `.env`, so a shared catalog never holds handles, emails, or tokens. See `.env.example`.

## Commands

| Command | What it does |
| --- | --- |
| `skillfit catalog init [dir] [--starter]` | Create a catalog (default `~/.skillfit`) |
| `skillfit report` | Packs, skills, and always-loaded context per project (`--json`) |
| `skillfit status` | Dry run of sync; `--check` exits 1 on drift (CI) |
| `skillfit sync` | Render the selected skills, rules, commands, and agents |
| `skillfit update` | `git pull --ff-only` the catalog, then sync |
| `skillfit init` | Add tracked `AGENTS.md`, `CLAUDE.md`, and `docs/agent/` to projects; never overwrites |
| `skillfit refresh --skill <name> \| --all` | Vendor upstream skills into the catalog |
| `skillfit audit` | Check provenance, staleness (180 days), packs, description sizes |

Select projects with `--project <path>`, `--root <dir>[,<dir>]`, or `--all` (this machine's profile). The catalog is found from `--catalog`, `SKILLFIT_CATALOG`, the nearest `skillfit.json` above the current folder, or `~/.skillfit`.

## The starter catalog

`--starter` gives you packs built from maintained upstream skills, plus two first-party ones:

| Pack | Selected by | Skills |
| --- | --- | --- |
| core | always | grilling (Matt Pocock), improve (shadcn) |
| react | `react` | vercel-react-best-practices, vercel-composition-patterns, react-doctor |
| nextjs | `next` | next-server-security, next-dev-loop, next-bundle-optimizer, Cache Components and Partial Prefetching workflows (manual-only), vercel-react-view-transitions (manual-only) |
| e2e | `@playwright/test` | playwright-e2e-testing |
| ui | `react-dom`, `vue`, `svelte`, `tailwindcss`, ... | frontend-design (Anthropic), interface-design, baseline-ui, fixing-accessibility, make-interfaces-feel-better, web-design-guidelines |
| shadcn | `components.json` | shadcn |
| motion | `motion`, `framer-motion`, `gsap`, ... | Emil Kowalski's animation skills, fixing-motion-performance |
| stripe | `stripe`, `@stripe/*` | stripe-best-practices, upgrade-stripe, stripe-projects |
| design-research | opt-in | ui-ux-pro-max |

Skills are vendored from their authors' repositories under their own licences when you run `refresh`; skillfit does not redistribute them.

Next.js 16.2+ ships version-matched docs in `node_modules/next/dist/docs`, and `next dev` adds a managed block to `AGENTS.md` pointing agents at them. That is why the starter has no generic "Next.js best practices" skill: workflows belong in skills, framework reference belongs in the bundled docs.

## FAQ

**Does it replace `npx skills` / skills.sh?** No. Those install skills. skillfit decides which repo gets which, keeps them in sync across many repos and agents, and measures the cost. Point `skill-sources.json` at any GitHub skill.

**What about my existing `.cursor/rules` or `.claude/skills`?** skillfit refuses to overwrite files it does not own. Move your own files into the catalog (shared) or `docs/agent/` (repo-specific), or pass `--force` once you have reviewed the collision.

**Does it commit anything to my projects?** No. Generated paths are added to `.git/info/exclude`. Only `skillfit init` creates tracked files (`AGENTS.md`, `CLAUDE.md`, `docs/agent/`), and only when you run it.

**Windows?** Yes. Skill folders are linked with directory junctions, which need no admin rights or developer mode.

## Contributing

Issues and PRs welcome, especially new detection signals and agent targets. See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` (Node 20+, no dependencies).

## License

MIT © Amin Keshavarzi
