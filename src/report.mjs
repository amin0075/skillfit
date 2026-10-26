import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadSources } from "./catalog.mjs";
import { resolveSelection } from "./detect.mjs";
import { effectiveMetadata, listingCost } from "./render.mjs";
import { loadProjectConfig } from "./sync.mjs";

// Rough rule of thumb for English prose in current tokenizers.
export const charsToTokens = (chars) => Math.round(chars / 4);

export function skillCosts(catalog, registry) {
  const sources = loadSources(catalog).skills;
  const costs = new Map();
  for (const name of registry.skills) {
    const path = resolve(catalog.skills, name, "SKILL.md");
    const metadata = existsSync(path) ? effectiveMetadata(readFileSync(path, "utf8"), sources[name]?.render?.frontmatter) : null;
    costs.set(name, listingCost(metadata, name));
  }
  return costs;
}

export function projectReport(catalog, registry, project, costs) {
  const { projectConfig } = loadProjectConfig(project.path, registry, project.scaffold);
  const selection = resolveSelection(project.path, registry, projectConfig, project.selection);
  const sum = (names) => names.reduce((total, name) => total + (costs.get(name) ?? 0), 0);
  const everything = sum(registry.skills);
  const selected = sum(selection.skills);
  return {
    project: basename(project.path),
    packs: selection.packs,
    skills: selection.skills.length,
    catalogSkills: registry.skills.length,
    tokens: charsToTokens(selected),
    tokensIfEverything: charsToTokens(everything),
    saved: everything ? Math.round((1 - selected / everything) * 100) : 0,
  };
}

const formatTokens = (tokens) => (tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens));

export function printReport(rows) {
  const width = Math.max(7, ...rows.map((row) => row.project.length));
  console.log(`${"project".padEnd(width)}  skills  always-loaded  vs. everything  packs`);
  for (const row of rows) {
    console.log(
      `${row.project.padEnd(width)}  ${`${row.skills}/${row.catalogSkills}`.padStart(6)}  `
      + `${`~${formatTokens(row.tokens)} tok`.padStart(13)}  ${`-${row.saved}%`.padStart(14)}  ${row.packs.join(", ")}`,
    );
  }
  if (rows.length > 1) {
    const tokens = rows.reduce((total, row) => total + row.tokens, 0);
    const everything = rows.reduce((total, row) => total + row.tokensIfEverything, 0);
    console.log(`\n${rows.length} projects load ~${formatTokens(tokens)} tokens of skill listings in total, `
      + `instead of ~${formatTokens(everything)} if every skill went everywhere (-${Math.round((1 - tokens / everything) * 100)}%).`);
  }
  console.log("Counts the skill names and descriptions every session loads; bodies load only when a skill is used. Manual-only skills cost 0.");
}
