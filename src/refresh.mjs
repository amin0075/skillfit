import { existsSync } from "node:fs";
import { cp, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadJson, loadSources } from "./catalog.mjs";
import { git } from "./sync.mjs";

// GITHUB_TOKEN (shell or catalog .env) lets refresh read private repositories.
// It is passed as a one-off HTTP header, never written into a URL, config, or log.
function cloneArgs(repository) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !repository.startsWith("https://github.com/")) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

export async function refreshSkills(catalog, options) {
  const manifest = loadSources(catalog);
  const selected = options.skill
    ? [[options.skill, manifest.skills[options.skill]]]
    : options.all
      ? Object.entries(manifest.skills).filter(([, entry]) => entry.source)
      : [];
  if (!selected.length) throw new Error("Choose --skill <name> or --all; only skills with a recorded source can be refreshed");
  for (const [name, entry] of selected) {
    if (!entry) throw new Error(`Unknown skill '${name}' in skill-sources.json`);
    if (!entry.source) throw new Error(`${name} has no recorded upstream source`);
  }
  if (options.dryRun) {
    for (const [name, entry] of selected) console.log(`${name}: would refresh from ${entry.source.repository} ${entry.source.path}`);
    return;
  }

  const tempRoot = await mkdtemp(resolve(tmpdir(), "stackfit-refresh-"));
  const lock = loadJson(catalog.sourcesLockPath, { schemaVersion: 1, skills: {} });
  const repositories = new Map();
  try {
    for (const [name, entry] of selected) {
      let checkout = repositories.get(entry.source.repository);
      if (!checkout) {
        checkout = resolve(tempRoot, `source-${repositories.size}`);
        const clone = git([...cloneArgs(entry.source.repository), "clone", "--quiet", "--depth", "1", entry.source.repository, checkout], catalog.root, "inherit");
        if (clone.status !== 0) throw new Error(`Could not clone ${entry.source.repository}`);
        repositories.set(entry.source.repository, checkout);
      }
      const source = resolve(checkout, entry.source.path);
      if (!existsSync(resolve(source, "SKILL.md"))) throw new Error(`${name}: upstream path ${entry.source.path} has no SKILL.md`);
      const staging = resolve(catalog.skills, `.${name}.refresh`);
      const destination = resolve(catalog.skills, name);
      await rm(staging, { recursive: true, force: true });
      await cp(source, staging, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      const revision = git(["rev-parse", "HEAD"], checkout).stdout.trim();
      lock.skills[name] = { repository: entry.source.repository, path: entry.source.path, revision, refreshedAt: new Date().toISOString() };
      console.log(`${name}: refreshed at ${revision.slice(0, 12)}`);
    }
    lock.skills = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(catalog.sourcesLockPath, `${JSON.stringify(lock, null, 2)}\n`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  console.log("Review with `git diff`, run `stackfit audit`, then commit the catalog.");
}
