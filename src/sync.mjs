import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { expandEnv, loadJson, loadSources } from "./catalog.mjs";
import { resolveSelection } from "./detect.mjs";
import { claudeAgent, claudeCommand, claudeRule, cursorRule, setFrontmatter } from "./render.mjs";

export const LOCK_NAME = ".skillfit.lock.json";
const LEGACY_LOCK_NAME = ".agent-config.lock.json";
const LOCAL_EXCLUDES = [LOCK_NAME, ".agents/", ".cursor/", ".claude/"];
const LOCAL_SCAFFOLD_EXCLUDES = ["CLAUDE.md", "docs/agent/"];

export function lstatMaybe(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
export const toPosixPath = (path) => path.replaceAll("\\", "/");
const projectKey = (projectPath, destination) => toPosixPath(relative(projectPath, destination));
const normalizeEntries = (entries = {}) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [toPosixPath(key), value]));

function loadLock(projectPath) {
  const current = resolve(projectPath, LOCK_NAME);
  const legacy = resolve(projectPath, LEGACY_LOCK_NAME);
  const previous = loadJson(existsSync(current) ? current : legacy, { files: {}, links: {} });
  return { ...previous, files: normalizeEntries(previous.files), links: normalizeEntries(previous.links) };
}

export function git(args, cwd, stdio = "pipe") {
  return spawnSync("git", args, { cwd, encoding: "utf8", stdio });
}

function currentRevision(cwd) {
  const result = git(["rev-parse", "HEAD"], cwd);
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}

function addFile(plan, source, destination, transform = undefined) {
  if (!existsSync(source)) throw new Error(`Configured source does not exist: ${source}`);
  const raw = readFileSync(source);
  const content = transform ? Buffer.from(transform(raw.toString("utf8"))) : raw;
  plan.set(destination, { source, content, hash: sha256(content) });
}

async function addTree(plan, sourceRoot, destinationRoot, render = {}) {
  const exclude = new Set(render.exclude ?? []);
  for (const source of await walkFiles(sourceRoot)) {
    const file = toPosixPath(relative(sourceRoot, source));
    if (exclude.has(file) || basename(file) === ".DS_Store") continue;
    const transform = file === "SKILL.md" && render.frontmatter ? (content) => setFrontmatter(content, render.frontmatter) : undefined;
    addFile(plan, source, resolve(destinationRoot, file), transform);
  }
}

const componentName = (file) => file.replace(/\.(md|mdc)$/, "");

function assertLocalComponentAllowed(projectName, projectConfig, kind, name, sharedNames) {
  if (!sharedNames.has(name)) return;
  if (new Set(projectConfig.overrides?.[kind] ?? []).has(name)) return;
  throw new Error(
    `${projectName}: repo-owned ${kind.slice(0, -1)} '${name}' conflicts with shared ${kind}; `
    + `rename it or add '${name}' to overrides.${kind} in docs/agent/config.json`,
  );
}

function addCommand(plan, projectPath, source, file) {
  const fill = (content) => expandEnv(content, `commands/${file}`);
  addFile(plan, source, resolve(projectPath, ".cursor/commands", file), fill);
  addFile(plan, source, resolve(projectPath, ".claude/commands", file), (content) => claudeCommand(fill(content)));
}

function addRule(plan, projectPath, source, name, cursorTransform = (content) => content) {
  const cursorContent = expandEnv(cursorTransform(readFileSync(source, "utf8")), `rules/${name}`);
  addFile(plan, source, resolve(projectPath, ".cursor/rules", `${name}.mdc`), () => cursorContent);
  const claudeContent = claudeRule(cursorContent);
  if (claudeContent !== null) addFile(plan, source, resolve(projectPath, ".claude/rules", `${name}.md`), () => claudeContent);
}

function addAgent(plan, projectPath, source, file) {
  const fill = (content) => expandEnv(content, `agents/${file}`);
  addFile(plan, source, resolve(projectPath, ".cursor/agents", file), fill);
  addFile(plan, source, resolve(projectPath, ".claude/agents", file), (content) => claudeAgent(fill(content)));
}

export function loadProjectConfig(projectPath, registry, scaffold) {
  const configPath = resolve(projectPath, registry.projectConfigPath);
  const projectConfig = scaffold ? loadJson(configPath, { schemaVersion: 1 }) : { schemaVersion: 1 };
  if (projectConfig.schemaVersion !== 1) throw new Error(`${basename(projectPath)}: unsupported ${registry.projectConfigPath} schema`);
  return { projectConfig, configPath };
}

export async function createPlan(catalog, projectPath, registry, { scaffold = true, selection: localSelection = {} } = {}) {
  const projectName = basename(projectPath);
  const { projectConfig, configPath } = loadProjectConfig(projectPath, registry, scaffold);
  const selection = resolveSelection(projectPath, registry, projectConfig, localSelection);
  const renderOptions = loadSources(catalog).skills;
  const sharedSkills = new Set(selection.skills);
  const sharedAgents = new Set(registry.adapters.agents.map(componentName));
  const sharedCommands = new Set(registry.adapters.commands.map(componentName));
  const sharedRules = new Set(registry.adapters.rules.map(componentName));
  const plan = new Map();
  const links = new Map([
    [resolve(projectPath, ".claude/skills"), "../.agents/skills"],
    [resolve(projectPath, ".cursor/skills"), "../.agents/skills"],
  ]);

  for (const skill of selection.skills) {
    const source = resolve(catalog.skills, skill);
    if (!existsSync(resolve(source, "SKILL.md"))) {
      throw new Error(`Skill '${skill}' is enabled but not in the catalog. Run \`skillfit refresh --skill ${skill}\` or add skills/${skill}/SKILL.md.`);
    }
    await addTree(plan, source, resolve(projectPath, ".agents/skills", skill), renderOptions[skill]?.render);
  }
  for (const file of registry.adapters.agents) addAgent(plan, projectPath, resolve(catalog.agents, file), file);
  for (const file of registry.adapters.commands) addCommand(plan, projectPath, resolve(catalog.commands, file), file);
  for (const file of registry.adapters.rules) addRule(plan, projectPath, resolve(catalog.rules, file), componentName(file));

  if (scaffold) {
    const localSkills = resolve(projectPath, "docs/agent/skills");
    if (existsSync(localSkills)) {
      for (const entry of await readdir(localSkills, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const source = resolve(localSkills, entry.name);
        if (!existsSync(resolve(source, "SKILL.md"))) throw new Error(`${projectName}: docs/agent/skills/${entry.name} lacks SKILL.md`);
        assertLocalComponentAllowed(projectName, projectConfig, "skills", entry.name, sharedSkills);
        await addTree(plan, source, resolve(projectPath, ".agents/skills", entry.name));
      }
    }
    const localKinds = [
      ["agents", "docs/agent/agents", sharedAgents, (source, file) => addAgent(plan, projectPath, source, file)],
      ["commands", "docs/agent/commands", sharedCommands, (source, file) => addCommand(plan, projectPath, source, file)],
      ["rules", "docs/agent/rules", sharedRules, (source, file) => {
        const name = componentName(file);
        addRule(plan, projectPath, source, name, (content) => cursorRule(content, name));
      }],
    ];
    for (const [kind, folder, shared, add] of localKinds) {
      const root = resolve(projectPath, folder);
      for (const source of await walkFiles(root)) {
        if (!source.endsWith(".md")) continue;
        const file = relative(root, source);
        assertLocalComponentAllowed(projectName, projectConfig, kind, componentName(file), shared);
        add(source, file);
      }
    }
  }

  return { plan, links, projectName, scaffold, packs: selection.packs, skills: selection.skills, configPath: scaffold ? relative(projectPath, configPath) : null };
}

async function ensureLocalGitExclude(projectPath, { scaffold = true } = {}) {
  const gitPath = git(["rev-parse", "--git-path", "info/exclude"], projectPath);
  const excludePath = gitPath.status === 0 ? resolve(projectPath, gitPath.stdout.trim()) : resolve(projectPath, ".git/info/exclude");
  const existing = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  const lines = new Set(existing.split(/\r?\n/));
  const wanted = scaffold ? LOCAL_EXCLUDES : [...LOCAL_EXCLUDES, ...LOCAL_SCAFFOLD_EXCLUDES];
  const additions = wanted.filter((entry) => !lines.has(entry));
  if (!additions.length) return;
  await mkdir(dirname(excludePath), { recursive: true });
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${prefix}# Managed locally by skillfit\n${additions.join("\n")}\n`);
}

// After removing a dropped skill's files, remove its now-empty folders (never the project root).
async function pruneEmptyParents(projectPath, directory) {
  let current = directory;
  while (current.startsWith(`${projectPath}${sep}`) && !lstatMaybe(current)?.isSymbolicLink()) {
    let entries;
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    if (entries.length) return;
    await rm(current, { recursive: true, force: true });
    current = dirname(current);
  }
}

// Windows junctions need no admin rights or developer mode; they store absolute targets.
const LINK_TYPE = platform() === "win32" ? "junction" : "dir";
const sameLinkTarget = (linkPath, target) => resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(dirname(linkPath), target);

export async function applyPlan(catalog, projectPath, planData, options) {
  const previous = loadLock(projectPath);
  const nextFiles = {};
  const nextLinks = {};
  const actions = [];
  // Managed symlinks this plan no longer wants. Files "found" through them are not
  // real collisions: the link is deleted before writes.
  const retiredLinks = Object.keys(previous.links ?? {})
    .map((key) => resolve(projectPath, key))
    .filter((linkPath) => !planData.links.has(linkPath) && lstatMaybe(linkPath)?.isSymbolicLink());
  const throughRetiredLink = (destination) => retiredLinks.some((linkPath) => destination.startsWith(`${linkPath}${sep}`));

  for (const [destination, item] of planData.plan) {
    const key = projectKey(projectPath, destination);
    nextFiles[key] = item.hash;
    const existing = existsSync(destination) && !throughRetiredLink(destination) ? await readFile(destination) : null;
    if (existing && sha256(existing) === item.hash) continue;
    if (existing && !previous.files[key] && !options.force) {
      throw new Error(`${planData.projectName}: unmanaged collision at ${key}; review it, then rerun with --force`);
    }
    actions.push({ type: existing ? "update" : "create", key, destination, item });
  }
  for (const key of Object.keys(previous.files)) {
    if (nextFiles[key]) continue;
    const destination = resolve(projectPath, key);
    const underLink = [...planData.links.keys()].find((linkPath) => destination.startsWith(`${linkPath}${sep}`) && lstatMaybe(linkPath)?.isSymbolicLink());
    if (!underLink && lstatMaybe(destination)) actions.push({ type: "delete", key, destination });
  }
  for (const [destination, target] of planData.links) {
    const key = projectKey(projectPath, destination);
    nextLinks[key] = target;
    const stat = lstatMaybe(destination);
    if (stat?.isSymbolicLink() && sameLinkTarget(destination, target)) continue;
    if (stat?.isDirectory()) {
      const unmanaged = (await walkFiles(destination)).map((path) => projectKey(projectPath, path)).filter((path) => !previous.files[path]);
      if (unmanaged.length && !options.force) throw new Error(`${planData.projectName}: unmanaged collision under ${key}: ${unmanaged[0]}`);
    } else if (stat && !previous.links?.[key] && !options.force) {
      throw new Error(`${planData.projectName}: unmanaged collision at ${key}; review it, then rerun with --force`);
    }
    actions.push({ type: stat ? "link" : "create-link", key, destination, target });
  }
  for (const key of Object.keys(previous.links ?? {})) {
    if (!nextLinks[key] && lstatMaybe(resolve(projectPath, key))) actions.push({ type: "delete", key, destination: resolve(projectPath, key) });
  }

  if (!options.dryRun) {
    await ensureLocalGitExclude(projectPath, { scaffold: planData.scaffold !== false });
    for (const action of actions.filter((item) => item.type === "delete")) {
      await rm(action.destination, { recursive: true, force: true });
      await pruneEmptyParents(projectPath, dirname(action.destination));
    }
    for (const action of actions.filter((item) => ["create", "update"].includes(item.type))) {
      await mkdir(dirname(action.destination), { recursive: true });
      await writeFile(action.destination, action.item.content);
    }
    for (const action of actions.filter((item) => ["link", "create-link"].includes(item.type))) {
      await rm(action.destination, { recursive: true, force: true });
      await mkdir(dirname(action.destination), { recursive: true });
      await symlink(action.target, action.destination, LINK_TYPE);
    }
    await writeFile(resolve(projectPath, LOCK_NAME), `${JSON.stringify({
      schemaVersion: 3,
      sourceRevision: currentRevision(catalog.root),
      projectConfig: planData.configPath,
      scaffold: planData.scaffold !== false,
      packs: planData.packs,
      generatedAt: new Date().toISOString(),
      files: nextFiles,
      links: nextLinks,
    }, null, 2)}\n`);
    await rm(resolve(projectPath, LEGACY_LOCK_NAME), { force: true });
  }
  return actions;
}
