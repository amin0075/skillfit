# stackfit

**Your agent loads every skill in every repo. It needs a handful.**

stackfit keeps one catalog of agent skills, rules, commands, and subagents, and gives each repository only what fits its stack: Next.js skills where there is `next`, Stripe skills where there is `stripe`, nothing for design in a Go service. It renders them for **Claude Code, Cursor, and Codex**, across every project on your machine, in one command.

![stackfit demo](https://raw.githubusercontent.com/amin0075/stackfit/main/media/demo.gif)

```bash
npx stackfit catalog init --starter   # a catalog in ~/.stackfit with curated packs
npx stackfit refresh --all            # vendor the upstream skills (Vercel, shadcn, Stripe, ...)
npx stackfit report --root ~/code     # what each repo would load, next to what your global skills cost today
npx stackfit sync --root ~/code       # write it
```

### Or let your agent do it

stackfit ships an agent skill that knows every command, recipe, and error message:

```bash
npx skills add amin0075/stackfit      # or copy skills/stackfit into ~/.claude/skills
```

Then ask your agent: *"Set up stackfit for my repos in ~/code and tell me honestly what it saves."* It measures your current global skills first, previews before writing, and never forces over your own files. The starter catalog includes the same skill.

## Why

Every installed skill puts its name and description into every agent session, so the agent knows it exists. Install 40 skills globally and a Go service pays for your React animation guides on every turn. Copy skills into each repo by hand and they drift, go stale, and lose your edits on the next update.

stackfit treats agent context like a dependency:

- **Packs, detected per repo.** Skills belong to packs. A pack is selected when the repo's manifests mention a dependency or contain a file: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, at the root and in subfolders like `web/`, `apps/*`, `packages/*`.
- **One catalog, every repo.** Machine profiles list your project folders on each computer (Mac at home, Windows at work). `stackfit update --all` pulls the catalog and syncs them all.
- **Measured, honestly.** `stackfit report` shows what each repo loads every session (skill listings + always-on rules) next to what your global skill folders already cost everywhere; `stackfit audit` flags stale, unsourced, and oversized skills.
- **Upstream skills without losing your edits.** Vendor skills from GitHub with `refresh`; shorten a description, make a skill manual-only, or drop files with `render` overrides that survive every refresh.
- **Native for each agent.** Claude Code gets `.claude/skills`, `.claude/rules` (glob rules become `paths:`), manual-only commands, and subagents. Cursor gets `.cursor/skills`, `.mdc` rules, commands, and agents. Codex reads `.agents/skills`. One physical copy, symlinked (junctions on Windows, no admin needed).
- **Safe.** Generated files are tracked in a lock and only those exact files are excluded from Git locally (your own `.claude/settings.json` stays visible). stackfit never overwrites a file it did not create, and never touches files your repo owns.

## Example

The starter catalog, four sample repos, and 31 skills installed globally the usual way:

```text
$ stackfit report --root ~/code
project         skills  skill listings     rules  per session  packs
ingest-worker        2        ~168 tok   ~83 tok     ~251 tok  core
marketing-site      25       ~1.5k tok   ~83 tok    ~1.6k tok  core, react, nextjs, ui, motion
payments-api         5        ~397 tok   ~83 tok     ~480 tok  core, stripe
storefront          24       ~1.5k tok   ~83 tok    ~1.6k tok  core, react, nextjs, e2e, ui, shadcn, stripe

With stackfit: ~4.0k tokens across 4 project(s). Every catalog skill in every repo would be ~8.7k.
Global skills add ~3.0k tokens to every session in every repo, with or without stackfit: ~/.claude/skills (31).
```

Read it honestly: the saving comes from moving skills out of global folders and letting each repo take only its packs. The Go worker drops from ~3.0k to ~251 tokens; a Next.js app that needs most packs saves little. If you only had a handful of global skills, start from an empty catalog with just those (`stackfit catalog init`) rather than the starter, or the starter's extra packs can add context instead of removing it. `report` always shows both numbers, so you can tell.

## How it works

```text
~/.stackfit/                        your catalog (keep it in a private Git repo)
  stackfit.json                     enabled skills + packs
  skill-sources.json                where each skill comes from, review dates, render overrides
  skills/<name>/SKILL.md            the skills
  rules/  commands/  agents/        shared adapters
  stackfit.local.json               (gitignored) your project folders per machine
  .env                              (gitignored) values for {{env:NAME}} placeholders

<project>/
  .agents/skills/                   the selected skills (one physical copy)
  .claude/skills  .cursor/skills    symlinks to it
  .claude/rules/*.md  .cursor/rules/*.mdc
  .claude/commands  .cursor/commands
  .claude/agents  .cursor/agents
  .stackfit.lock.json               what stackfit owns here
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

Or, without touching the repo, on its entry in `stackfit.local.json`.

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

Then `stackfit sync --all` on each machine. Without `projects`, every Git repo under `roots` is synced.

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

`stackfit refresh --skill shadcn` replaces the vendored copy and records the upstream commit in `skill-sources.lock.json`. Your `render` overrides apply at sync time, so they survive. Set `"disable-model-invocation": true` on long one-off workflows (migrations, adoptions) so they cost nothing until you call them.

### Personal values

Commands, rules, and agents can contain `{{env:NAME}}`. stackfit fills them at sync time from your shell or the catalog's gitignored `.env`, so a shared catalog never holds handles, emails, or tokens. See `.env.example`.

## Commands

| Command | What it does |
| --- | --- |
| `stackfit catalog init [dir] [--starter]` | Create a catalog (default `~/.stackfit`) |
| `stackfit report` | Per project: packs, skills, skill-listing and rule tokens; plus your global skill folders as a baseline (`--json`) |
| `stackfit status` | Dry run of sync; `--check` exits 1 on drift (CI) |
| `stackfit sync` | Render the selected skills, rules, commands, and agents |
| `stackfit update` | `git pull --ff-only` the catalog, then sync |
| `stackfit init` | Add tracked `AGENTS.md`, `CLAUDE.md`, and `docs/agent/` to projects; never overwrites |
| `stackfit refresh --skill <name> \| --all` | Vendor upstream skills into the catalog |
| `stackfit audit` | Check provenance, staleness (180 days), packs, description sizes |

Select projects with `--project <path>`, `--root <dir>[,<dir>]`, or `--all` (this machine's profile). The catalog is found from `--catalog`, `STACKFIT_CATALOG`, the nearest `stackfit.json` above the current folder, or `~/.stackfit`.

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

Skills are vendored from their authors' repositories under their own licences when you run `refresh`; stackfit does not redistribute them.

Next.js 16.2+ ships version-matched docs in `node_modules/next/dist/docs`, and `next dev` adds a managed block to `AGENTS.md` pointing agents at them. That is why the starter has no generic "Next.js best practices" skill: workflows belong in skills, framework reference belongs in the bundled docs.

## FAQ

**Does it replace `npx skills` / skills.sh?** No. Those install skills. stackfit decides which repo gets which, keeps them in sync across many repos and agents, and measures the cost. Point `skill-sources.json` at any GitHub skill.

**What about my existing `.cursor/rules` or `.claude/skills`?** stackfit refuses to overwrite files it does not own. Move your own files into the catalog (shared) or `docs/agent/` (repo-specific), or pass `--force` once you have reviewed the collision.

**Does it commit anything to my projects?** No. Generated paths are added to `.git/info/exclude`. Only `stackfit init` creates tracked files (`AGENTS.md`, `CLAUDE.md`, `docs/agent/`), and only when you run it.

**Windows?** Yes. Skill folders are linked with directory junctions, which need no admin rights or developer mode.

## Contributing

Issues and PRs welcome, especially new detection signals and agent targets. See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` (Node 22+, no dependencies).

## License

MIT © Amin Keshavarzi
