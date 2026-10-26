import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

export const REGISTRY_FILE = "stackfit.json";
export const LOCAL_FILE = "stackfit.local.json";
export const SOURCES_FILE = "skill-sources.json";
export const SOURCES_LOCK_FILE = "skill-sources.lock.json";

export function loadJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error.message}`);
  }
}

// `.env` files never override variables already set in the shell.
export function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function expandHome(pathValue, base = process.cwd()) {
  const trimmed = pathValue.trim();
  if (!trimmed) throw new Error("Empty path");
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return resolve(homedir(), trimmed.slice(2));
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed);
}

function findUp(start, file) {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, file))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Catalog = the folder holding stackfit.json, skills/, rules/, commands/, agents/.
// Resolution: --catalog, then STACKFIT_CATALOG (shell or ./.env), then the nearest
// stackfit.json above the working directory, then ~/.stackfit.
export function resolveCatalog(explicit) {
  loadEnvFile(resolve(process.cwd(), ".env"));
  const candidates = [
    explicit && expandHome(explicit),
    process.env.STACKFIT_CATALOG && expandHome(process.env.STACKFIT_CATALOG),
    findUp(process.cwd(), REGISTRY_FILE),
    resolve(homedir(), ".stackfit"),
  ].filter(Boolean);
  const root = candidates.find((path) => existsSync(resolve(path, REGISTRY_FILE)));
  if (!root) {
    const tried = explicit || process.env.STACKFIT_CATALOG;
    throw new Error(
      tried
        ? `No ${REGISTRY_FILE} in ${expandHome(tried)}`
        : `No catalog found. Create one with \`stackfit catalog init\` (your own skills) or \`stackfit catalog init --starter\` (curated packs), or point to one with STACKFIT_CATALOG / --catalog.`,
    );
  }
  loadEnvFile(resolve(root, ".env"));
  return catalogPaths(root);
}

export function catalogPaths(root) {
  return {
    root,
    registryPath: resolve(root, REGISTRY_FILE),
    localPath: process.env.STACKFIT_LOCAL_CONFIG ? resolve(process.env.STACKFIT_LOCAL_CONFIG) : resolve(root, LOCAL_FILE),
    sourcesPath: resolve(root, SOURCES_FILE),
    sourcesLockPath: resolve(root, SOURCES_LOCK_FILE),
    skills: resolve(root, "skills"),
    agents: resolve(root, "agents"),
    commands: resolve(root, "commands"),
    rules: resolve(root, "rules"),
  };
}

export function loadRegistry(catalog) {
  const registry = loadJson(catalog.registryPath);
  if (registry.schemaVersion !== 3) throw new Error(`${REGISTRY_FILE}: unsupported schemaVersion ${registry.schemaVersion} (expected 3)`);
  return {
    projectConfigPath: "docs/agent/config.json",
    packs: {},
    ...registry,
    adapters: { agents: [], commands: [], rules: [], ...(registry.adapters ?? {}) },
  };
}

export function loadSources(catalog) {
  return loadJson(catalog.sourcesPath, { schemaVersion: 2, skills: {} });
}

const warned = new Set();

// `{{env:NAME}}` in commands, rules, and agents is filled from the environment at sync time,
// so personal values (emails, org names) live in the catalog's gitignored .env.
export function expandEnv(content, origin) {
  return content.replace(/\{\{env:([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (placeholder, name) => {
    if (process.env[name] !== undefined) return process.env[name];
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`warning: ${origin} uses {{env:${name}}} but ${name} is not set; left as-is`);
    }
    return placeholder;
  });
}
