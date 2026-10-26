import { existsSync, readdirSync } from "node:fs";
import { hostname, platform } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { expandHome, loadJson } from "./catalog.mjs";

export function currentMachineIdentity() {
  return {
    platform: process.env.STACKFIT_PLATFORM || platform(),
    hostname: process.env.STACKFIT_HOSTNAME || hostname(),
  };
}

function scoreMachineMatch(entry, identity) {
  const match = entry.match ?? {};
  if (match.platform !== identity.platform) return -1;
  if (match.hostname) return match.hostname.toLowerCase() === identity.hostname.toLowerCase() ? 2 : -1;
  return 1;
}

export function resolveMachineProfile(localConfig, identity = currentMachineIdentity()) {
  if (!localConfig) return null;
  if (localConfig.schemaVersion !== 1) throw new Error("Unsupported stackfit.local.json schemaVersion");
  if (!Array.isArray(localConfig.machines) || !localConfig.machines.length) {
    throw new Error("stackfit.local.json must declare at least one machine");
  }
  let best = null;
  let bestScore = -1;
  for (const entry of localConfig.machines) {
    const score = scoreMachineMatch(entry, identity);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (!best) {
    throw new Error(
      `No stackfit.local.json machine matches ${identity.platform} hostname=${identity.hostname}.`
      + " Update the local file or pass --project/--root.",
    );
  }
  return best;
}

function discoverProjects(root, catalogRoot) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name))
    .filter((path) => path !== catalogRoot && existsSync(resolve(path, ".git")))
    .sort();
}

function normalizeProjectEntry(entry) {
  if (typeof entry === "string") return { name: entry, scaffold: true, selection: {} };
  if (entry && typeof entry === "object" && typeof entry.name === "string") {
    return {
      name: entry.name,
      scaffold: entry.scaffold !== false,
      selection: { packs: entry.packs, excludePacks: entry.excludePacks, skills: entry.skills },
    };
  }
  throw new Error('Invalid projects entry in stackfit.local.json; use a string name or { "name": "...", "packs": [] }');
}

function resolveNamedProjects(roots, entries) {
  return entries.map(normalizeProjectEntry).map((entry) => {
    const matches = roots.map((root) => resolve(root, entry.name)).filter((path) => existsSync(resolve(path, ".git")));
    if (!matches.length) {
      throw new Error(
        `Configured project '${entry.name}' not found under machine roots: ${roots.join(", ")}.`
        + " Remove it from stackfit.local.json or add the folder that holds it to roots.",
      );
    }
    if (matches.length > 1) throw new Error(`Configured project '${entry.name}' matches multiple roots: ${matches.join(", ")}`);
    return { path: matches[0], scaffold: entry.scaffold, selection: entry.selection };
  });
}

function lookupProjectEntry(catalog, projectPath) {
  const fallback = { scaffold: true, selection: {} };
  try {
    const machine = resolveMachineProfile(loadJson(catalog.localPath, null));
    const entry = machine?.projects?.map(normalizeProjectEntry).find((item) => item.name === basename(projectPath));
    return entry ? { scaffold: entry.scaffold, selection: entry.selection } : fallback;
  } catch {
    return fallback;
  }
}

const asTargets = (paths) => paths.map((path) => ({ path, scaffold: true, selection: {} }));

export function selectedProjects(catalog, options) {
  if (options.project) {
    const path = resolve(options.project);
    return { projects: [{ path, ...lookupProjectEntry(catalog, path) }] };
  }
  if (options.root) {
    const roots = options.root.split(",").map((root) => expandHome(root));
    const projects = [...new Set(roots.flatMap((root) => discoverProjects(root, catalog.root)))].sort();
    if (!projects.length) throw new Error(`No Git repositories directly under ${roots.join(", ")}`);
    return { projects: asTargets(projects) };
  }
  if (!options.all) throw new Error("Choose --project <path>, --root <dir>, or --all (this machine's stackfit.local.json)");
  const machine = resolveMachineProfile(loadJson(catalog.localPath, null));
  if (!machine) return { projects: asTargets(discoverProjects(dirname(catalog.root), catalog.root)) };
  const roots = machine.roots.map((root) => expandHome(root, catalog.root));
  const missing = roots.filter((root) => !existsSync(root));
  if (missing.length) {
    throw new Error(`Machine '${machine.id}' roots do not exist: ${missing.join(", ")}. Update stackfit.local.json for this machine.`);
  }
  const identity = currentMachineIdentity();
  const resolvedMachine = { id: machine.id, platform: identity.platform, hostname: identity.hostname, roots };
  const projects = machine.projects?.length
    ? resolveNamedProjects(roots, machine.projects)
    : asTargets([...new Set(roots.flatMap((root) => discoverProjects(root, catalog.root)))].sort());
  return { projects, machine: resolvedMachine };
}
