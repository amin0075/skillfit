import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadRegistry, loadSources } from "./catalog.mjs";
import { effectiveMetadata, listingCost } from "./render.mjs";
import { charsToTokens } from "./report.mjs";

const STALE_DAYS = 180;
const DESCRIPTION_LIMIT = 1024;

export function auditCatalog(catalog, { now = Date.now() } = {}) {
  const registry = loadRegistry(catalog);
  const sources = loadSources(catalog);
  const errors = [];
  const warnings = [];
  const directories = existsSync(catalog.skills)
    ? readdirSync(catalog.skills, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort()
    : [];

  const metadataByName = new Map();
  for (const name of directories) {
    const skillPath = resolve(catalog.skills, name, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(`${name}: missing SKILL.md`);
      continue;
    }
    const content = readFileSync(skillPath, "utf8");
    const metadata = effectiveMetadata(content, sources.skills[name]?.render?.frontmatter);
    metadataByName.set(name, metadata);
    if (!metadata.name || !metadata.description) errors.push(`${name}: frontmatter needs name and description`);
    if (metadata.name && metadata.name !== name) errors.push(`${name}: frontmatter name is '${metadata.name}' (directory name must match, or set render.frontmatter.name)`);
    if (metadata.description?.length > DESCRIPTION_LIMIT) warnings.push(`${name}: description is ${metadata.description.length} chars (claude.ai rejects > ${DESCRIPTION_LIMIT})`);
    if (content.split("\n").length > 500) warnings.push(`${name}: SKILL.md over 500 lines; move details into referenced files`);
  }

  for (const [name, provenance] of Object.entries(sources.skills)) {
    if (!registry.skills.includes(name) && !directories.includes(name)) warnings.push(`skill-sources.json: '${name}' is neither enabled nor in skills/`);
    if (provenance.kind === "external" && !provenance.source) warnings.push(`${name}: external origin is not recorded; refresh is disabled`);
    if (!provenance.reviewed) warnings.push(`${name}: no 'reviewed' date in skill-sources.json`);
    else {
      const age = (now - Date.parse(provenance.reviewed)) / 86_400_000;
      if (age > STALE_DAYS) warnings.push(`${name}: last reviewed ${provenance.reviewed} (${Math.floor(age)} days ago); check it is still current and worth its context`);
    }
  }

  for (const name of registry.skills) {
    if (directories.includes(name)) {
      if (!sources.skills[name]) warnings.push(`${name}: no skill-sources.json entry (add kind: custom or external)`);
      continue;
    }
    if (sources.skills[name]?.source) errors.push(`${name}: enabled but not vendored yet; run \`stackfit refresh --skill ${name}\``);
    else errors.push(`stackfit.json: unknown skill '${name}'`);
  }
  for (const name of directories) {
    if (!registry.skills.includes(name)) warnings.push(`${name}: in skills/ but not enabled in stackfit.json`);
  }

  const packed = new Set();
  for (const [packName, pack] of Object.entries(registry.packs)) {
    for (const name of pack.skills) {
      if (!registry.skills.includes(name)) errors.push(`pack '${packName}': skill '${name}' is not enabled in stackfit.json`);
      packed.add(name);
    }
    if (pack.always && pack.detect) warnings.push(`pack '${packName}': 'always' makes 'detect' redundant`);
  }
  for (const name of registry.skills) {
    if (!packed.has(name)) warnings.push(`${name}: enabled but in no pack; it only reaches projects that list it under 'skills'`);
  }
  for (const [kind, files] of Object.entries(registry.adapters)) {
    for (const file of files) if (!existsSync(resolve(catalog.root, kind, file))) errors.push(`unknown adapter ${kind}/${file}`);
  }

  const cost = (names) => names.reduce((total, name) => total + listingCost(metadataByName.get(name), name), 0);
  const packCosts = Object.entries(registry.packs).map(([name, pack]) => ({ name, always: Boolean(pack.always), tokens: charsToTokens(cost(pack.skills)) }));
  return { errors, warnings, skills: directories.length, packs: packCosts, adapters: Object.values(registry.adapters).flat().length, totalTokens: charsToTokens(cost([...packed])) };
}

export function printAudit(result) {
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const error of result.errors) console.error(`error: ${error}`);
  console.log(`Audited ${result.skills} skills, ${result.packs.length} packs, and ${result.adapters} adapters.`);
  console.log("Always-loaded description cost per pack (approx. tokens; manual-only skills cost 0):");
  for (const pack of result.packs) console.log(`  ${pack.name.padEnd(18)} ${String(pack.tokens).padStart(5)}${pack.always ? "  (every project)" : ""}`);
  console.log(`  ${"all packs".padEnd(18)} ${String(result.totalTokens).padStart(5)}`);
}
