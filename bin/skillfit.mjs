#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, resolveCatalog } from "../src/catalog.mjs";
import { auditCatalog, printAudit } from "../src/audit.mjs";
import { selectedProjects } from "../src/projects.mjs";
import { refreshSkills } from "../src/refresh.mjs";
import { printReport, projectReport, skillCosts } from "../src/report.mjs";
import { initCatalog, initProject } from "../src/scaffold.mjs";
import { applyPlan, createPlan, git } from "../src/sync.mjs";

const VERSION = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;

const HELP = `skillfit ${VERSION}: give each repo only the agent skills that fit its stack.

Usage: skillfit <command> [options]

Commands:
  catalog init [dir]    Create a catalog (default ~/.skillfit); --starter adds curated packs
  report                Show packs, skills, and always-loaded context per project
  status                Dry run of sync; --check exits 1 when anything would change (CI)
  sync                  Render the selected skills, rules, commands, and agents into projects
  update                git pull --ff-only the catalog, then sync
  init                  Add tracked docs/agent scaffolding to projects; never overwrites
  refresh               Vendor upstream skills into the catalog (--skill <name> | --all)
  audit                 Check the catalog: provenance, staleness, packs, context cost

Project selection:
  --project <path>      One repository
  --all                 This machine's projects from skillfit.local.json
  --root <dir>[,<dir>]  Every Git repository directly under these folders

Options:
  --catalog <dir>       Catalog folder (else SKILLFIT_CATALOG, the nearest skillfit.json, ~/.skillfit)
  --dry-run             Report without writing
  --force               Take ownership of colliding unmanaged files
  --quiet               Summaries only
  --json                Machine-readable output (report, audit)
  --skip-pull           update without git pull
  --version, --help

Docs: https://github.com/amin0075/skillfit`;

function parseArgs(argv) {
  const options = { positional: [] };
  const flags = { "--all": "all", "--force": "force", "--dry-run": "dryRun", "--quiet": "quiet", "--skip-pull": "skipPull", "--check": "check", "--json": "json", "--starter": "starter", "--help": "help", "-h": "help", "--version": "version", "-v": "version" };
  const values = { "--project": "project", "--root": "root", "--skill": "skill", "--catalog": "catalog" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg]) {
      if (argv[index + 1] === undefined) throw new Error(`${arg} needs a value`);
      options[values[arg]] = argv[++index];
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else options.positional.push(arg);
  }
  [options.command, ...options.args] = options.positional;
  return options;
}

async function run(options) {
  if (options.version) return console.log(VERSION);
  if (options.help || !options.command) return console.log(HELP);
  const { command } = options;

  if (command === "catalog") {
    if (options.args[0] !== "init") throw new Error("Usage: skillfit catalog init [dir] [--starter]");
    return initCatalog(options.args[1], options);
  }

  const catalog = resolveCatalog(options.catalog);
  if (command === "audit") {
    const result = auditCatalog(catalog);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printAudit(result);
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  if (command === "refresh") return refreshSkills(catalog, options);
  if (!["status", "sync", "update", "init", "report"].includes(command)) throw new Error(`Unknown command '${command}'. Run skillfit --help.`);

  if (command === "update" && !options.skipPull) {
    if (git(["status", "--porcelain"], catalog.root).stdout.trim()) throw new Error("Catalog has local changes; commit or stash them before update");
    if (git(["pull", "--ff-only"], catalog.root, "inherit").status !== 0) throw new Error("Could not fast-forward the catalog");
  }
  const { projects, machine } = selectedProjects(catalog, options);
  if (machine && !options.quiet && !options.json) console.log(`machine: ${machine.id} (${machine.platform}, ${machine.hostname})`);

  if (command === "init") {
    let total = 0;
    for (const project of projects) total += await initProject(project.path, { ...options, scaffold: project.scaffold });
    return console.log(`${options.dryRun ? "Would create" : "Created"} ${total} tracked docs file(s) across ${projects.length} project(s).`);
  }

  const registry = loadRegistry(catalog);
  if (command === "report") {
    const costs = skillCosts(catalog, registry);
    const rows = projects.map((project) => projectReport(catalog, registry, project, costs));
    return options.json ? console.log(JSON.stringify(rows, null, 2)) : printReport(rows);
  }

  if (command === "status") options.dryRun = true;
  let total = 0;
  for (const project of projects) {
    const plan = await createPlan(catalog, project.path, registry, { scaffold: project.scaffold, selection: project.selection });
    const actions = await applyPlan(catalog, project.path, plan, options);
    total += actions.length;
    const suffix = project.scaffold ? "" : " [adapter-only]";
    console.log(`${plan.projectName}: ${actions.length ? `${actions.length} change(s)` : "up to date"}${suffix}`);
    if (!options.quiet) {
      console.log(`  packs: ${plan.packs.join(", ")}`);
      for (const action of actions) console.log(`  ${action.type.padEnd(6)} ${action.key}`);
    }
  }
  console.log(`${options.dryRun ? "Would apply" : "Applied"} ${total} generated change(s) across ${projects.length} project(s).`);
  if (options.check && total) process.exitCode = 1;
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(`skillfit: ${error.message}`);
  process.exitCode = 1;
});
