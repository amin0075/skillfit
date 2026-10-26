import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const SCAN_SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor", "venv", "__pycache__"]);

// Root, every top-level folder, and one level below it: covers `web/`, `apps/*`, `packages/*`.
export function candidateDirectories(projectPath) {
  const children = (directory) => {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SCAN_SKIP.has(entry.name))
        .map((entry) => resolve(directory, entry.name));
    } catch {
      return [];
    }
  };
  const level1 = children(projectPath);
  return [projectPath, ...level1, ...level1.flatMap(children)];
}

const normalize = (name) => name.trim().toLowerCase();

// Manifest readers return dependency names. Regex-based on purpose: detection only needs names.
const MANIFESTS = {
  "package.json": (text) => {
    const manifest = JSON.parse(text);
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .flatMap((field) => Object.keys(manifest[field] ?? {}));
  },
  "requirements.txt": (text) => text.split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line && !line.startsWith("-"))
    .map((line) => line.split(/[\s<>=!~;[]/)[0]),
  "pyproject.toml": (text) => [...text.matchAll(/^\s*["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;[\s"']|$)/gm)].map((match) => match[1])
    .concat([...text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(?:["'{^~*\d])/gm)].map((match) => match[1])),
  "go.mod": (text) => [...text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v[\d.]/gm)].map((match) => match[1]),
  "Cargo.toml": (text) => {
    const names = [];
    let inDeps = false;
    for (const line of text.split(/\r?\n/)) {
      const section = line.match(/^\s*\[([^\]]+)\]/);
      if (section) inDeps = /(^|\.)(dev-|build-)?dependencies$/.test(section[1]);
      else if (inDeps) {
        const key = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
        if (key) names.push(key[1]);
      }
    }
    return names;
  },
  "composer.json": (text) => {
    const manifest = JSON.parse(text);
    return [...Object.keys(manifest.require ?? {}), ...Object.keys(manifest["require-dev"] ?? {})];
  },
};

export function detectionSignals(projectPath) {
  const dependencies = new Set();
  const files = new Set();
  for (const directory of candidateDirectories(projectPath)) {
    let entries;
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of entries) {
      files.add(name);
      const reader = MANIFESTS[name] ?? (/^requirements[-.\w]*\.txt$/.test(name) ? MANIFESTS["requirements.txt"] : null);
      if (!reader) continue;
      try {
        for (const dependency of reader(readFileSync(resolve(directory, name), "utf8"))) dependencies.add(normalize(dependency));
      } catch {
        // An unreadable manifest simply contributes no signals.
      }
    }
  }
  return { dependencies, files };
}

export function packMatches(pack, signals) {
  const detect = pack.detect ?? {};
  return (detect.dependencies ?? []).some((name) => signals.dependencies.has(normalize(name)))
    || (detect.files ?? []).some((name) => signals.files.has(name));
}

// Packs are selected by: always-on, explicit request, or auto-detection (packs without
// `detect` are opt-in only). Explicit skills are added, disabledSharedSkills removed last.
export function resolveSelection(projectPath, registry, projectConfig = {}, localSelection = {}) {
  const packs = registry.packs ?? {};
  const known = new Set(registry.skills);
  const requested = new Set([...(projectConfig.packs ?? []), ...(localSelection.packs ?? [])]);
  const excluded = new Set([...(projectConfig.excludePacks ?? []), ...(localSelection.excludePacks ?? [])]);
  for (const name of [...requested, ...excluded]) {
    if (!packs[name]) throw new Error(`${basename(projectPath)}: unknown pack '${name}'`);
  }
  const autodetect = projectConfig.detect !== false;
  const signals = autodetect ? detectionSignals(projectPath) : null;
  const selected = Object.entries(packs)
    .filter(([name, pack]) => pack.always
      || requested.has(name)
      || (autodetect && pack.detect && !excluded.has(name) && packMatches(pack, signals)))
    .map(([name]) => name);
  const skills = new Set(selected.flatMap((name) => packs[name].skills));
  for (const name of [...(projectConfig.skills ?? []), ...(localSelection.skills ?? [])]) {
    if (!known.has(name)) throw new Error(`${basename(projectPath)}: unknown shared skill '${name}'`);
    skills.add(name);
  }
  for (const name of projectConfig.disabledSharedSkills ?? []) skills.delete(name);
  return { packs: selected, skills: [...skills].filter((name) => known.has(name)).sort() };
}
