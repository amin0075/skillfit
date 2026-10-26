import { existsSync } from "node:fs";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome } from "./catalog.mjs";

const STARTER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../starter");

async function writeMissing(root, files, { dryRun }) {
  const created = [];
  for (const [key, content] of Object.entries(files)) {
    const destination = resolve(root, key);
    if (existsSync(destination)) continue;
    created.push(key);
    if (dryRun) continue;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return created;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Tracked per-project context. Never overwrites.
export async function initProject(projectPath, options) {
  if (options.scaffold === false) {
    console.log(`${basename(projectPath)}: skipped scaffold (adapter-only project)`);
    return 0;
  }
  const created = await writeMissing(projectPath, {
    "AGENTS.md": "# Repository agent instructions\n\nRead `docs/agent/index.md` first, then load only the pages and repo-owned components relevant to the task. Repository instructions take precedence over shared defaults when they conflict.\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "docs/agent/config.json": json({ schemaVersion: 1, packs: [], excludePacks: [], skills: [], overrides: { skills: [], agents: [], commands: [], rules: [] } }),
    "docs/agent/index.md": "# Agent context\n\nRead only the page relevant to the task:\n\n- `architecture.md`: structure, boundaries, and generated code\n- `design-system.md`: UI primitives, tokens, and visual conventions\n- `workflows.md`: package manager, checks, Git, PR, and release policy\n- `rules/*.md`: additional repository constraints, when relevant\n\nRepository-owned components live under `docs/agent/` (`skills/<name>/SKILL.md`, `commands/*.md`, `agents/*.md`, `rules/*.md`). Run `stackfit sync` to render them for each agent.\n",
    "docs/agent/architecture.md": "# Architecture\n\nDocument stable repository boundaries and where new code belongs. Link existing detailed docs instead of duplicating them.\n",
    "docs/agent/design-system.md": "# Design system\n\nDocument the canonical UI primitives, tokens, typography, and accessibility conventions. Remove this page for repositories without a UI.\n",
    "docs/agent/workflows.md": "# Workflows\n\nDocument the package manager, validation commands, generated files, branch/PR policy, and release automation.\n",
  }, options);
  console.log(`${basename(projectPath)}: ${created.length ? `${created.length} tracked docs file(s)` : "already initialized"}`);
  if (!options.quiet) for (const key of created) console.log(`  create ${key}`);
  return created.length;
}

async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  return files;
}

// A catalog is a plain folder you keep in your own (usually private) Git repository.
export async function initCatalog(target, options) {
  const root = expandHome(target ?? "~/.stackfit");
  const created = [];
  if (options.starter) {
    for (const source of await listFiles(STARTER_ROOT)) {
      const key = relative(STARTER_ROOT, source);
      const destination = resolve(root, key === "gitignore" ? ".gitignore" : key);
      if (existsSync(destination)) continue;
      created.push(relative(root, destination));
      if (options.dryRun) continue;
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
    }
  } else {
    created.push(...await writeMissing(root, {
      "stackfit.json": json({ $schema: "https://unpkg.com/stackfit/schemas/stackfit.schema.json", schemaVersion: 3, skills: [], packs: { core: { description: "Every repository.", always: true, skills: [] } }, adapters: { agents: [], commands: [], rules: [] } }),
      "skill-sources.json": json({ schemaVersion: 2, skills: {} }),
      "stackfit.local.example.json": json({ schemaVersion: 1, machines: [{ id: "laptop", match: { platform: "darwin" }, roots: ["~/code"] }] }),
      ".env.example": "# Copy to .env (gitignored). Values here fill {{env:NAME}} placeholders in commands, rules, and agents.\n# STACKFIT_CATALOG=~/path/to/this/catalog\n# GITHUB_TOKEN=\n",
      ".gitignore": "stackfit.local.json\n.env\nskills/.*.refresh/\n.DS_Store\n",
      "skills/.gitkeep": "",
    }, options));
  }
  console.log(`${options.dryRun ? "Would create" : "Created"} catalog at ${root} (${created.length} file(s)).`);
  if (!options.quiet) for (const key of created) console.log(`  create ${key}`);
  console.log(options.starter
    ? "\nNext:\n  stackfit refresh --all      # vendor the starter's upstream skills\n  stackfit audit\n  stackfit report --root ~/code\n  stackfit sync --root ~/code"
    : "\nNext: add skills under skills/<name>/SKILL.md, list them in stackfit.json and a pack, then `stackfit sync --project <repo>`.");
  if (!root.endsWith(".stackfit")) console.log(`\nPoint stackfit at it with --catalog ${target}, STACKFIT_CATALOG, or run commands from inside the folder.`);
  return created.length;
}
