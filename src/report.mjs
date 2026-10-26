import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { loadSources } from "./catalog.mjs";
import { effectiveMetadata, listingCost, parseFrontmatter } from "./render.mjs";
import { createPlan } from "./sync.mjs";

// Rough rule of thumb for English prose in current tokenizers.
export const charsToTokens = (chars) => Math.round(chars / 4);

// Folders whose skills load in every repo regardless of stackfit.
export const GLOBAL_SKILL_DIRS = [".claude/skills", ".agents/skills", ".cursor/skills", ".codex/skills"];

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

export function globalSkills(home = homedir()) {
  const folders = [];
  for (const relativeDir of GLOBAL_SKILL_DIRS) {
    const directory = resolve(home, relativeDir);
    let names;
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    let count = 0;
    let chars = 0;
    for (const name of names) {
      const skillFile = resolve(directory, name, "SKILL.md");
      try {
        if (!statSync(skillFile).isFile()) continue;
      } catch {
        continue;
      }
      count += 1;
      chars += listingCost(effectiveMetadata(readFileSync(skillFile, "utf8")), name);
    }
    if (count) folders.push({ path: `~/${relativeDir}`, skills: count, tokens: charsToTokens(chars) });
  }
  return { folders, tokens: folders.reduce((total, folder) => total + folder.tokens, 0) };
}

// Uses the same plan as `sync`, so the numbers describe exactly what would be written:
// catalog and repo-owned skills, overrides applied, and always-on Claude rules.
export async function projectReport(catalog, registry, project, costs) {
  const plan = await createPlan(catalog, project.path, registry, { scaffold: project.scaffold, selection: project.selection });
  let listingChars = 0;
  let ruleChars = 0;
  let skills = 0;
  for (const [destination, item] of plan.plan) {
    const key = destination.slice(project.path.length + 1).replaceAll("\\", "/");
    const content = item.content.toString("utf8");
    const skill = key.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/);
    if (skill) {
      skills += 1;
      listingChars += listingCost(parseFrontmatter(content).fields, skill[1]);
    } else if (/^\.claude\/rules\/.+\.md$/.test(key) && !parseFrontmatter(content).fields.paths && !/^---\r?\npaths:/.test(content)) {
      ruleChars += content.length;
    }
  }
  const everything = [...costs.values()].reduce((total, cost) => total + cost, 0);
  const listingTokens = charsToTokens(listingChars);
  const ruleTokens = charsToTokens(ruleChars);
  const tokensIfEverything = charsToTokens(everything) + ruleTokens;
  const tokens = listingTokens + ruleTokens;
  return {
    project: basename(project.path),
    packs: plan.packs,
    skills,
    catalogSkills: registry.skills.length,
    listingTokens,
    ruleTokens,
    tokens,
    tokensIfEverything,
    saved: tokensIfEverything ? Math.round((1 - tokens / tokensIfEverything) * 100) : 0,
  };
}

const formatTokens = (tokens) => (tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens));
const tok = (tokens) => `~${formatTokens(tokens)} tok`;

export function printReport({ projects: rows, global }) {
  const width = Math.max(7, ...rows.map((row) => row.project.length));
  console.log(`${"project".padEnd(width)}  skills  skill listings     rules  per session  packs`);
  for (const row of rows) {
    console.log(
      `${row.project.padEnd(width)}  ${String(row.skills).padStart(6)}  ${tok(row.listingTokens).padStart(14)}  ${tok(row.ruleTokens).padStart(8)}  `
      + `${tok(row.tokens).padStart(11)}  ${row.packs.join(", ")}`,
    );
  }
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const everything = rows.reduce((sum, row) => sum + row.tokensIfEverything, 0);
  console.log(`\nWith stackfit: ~${formatTokens(total)} tokens across ${rows.length} project(s). Every catalog skill in every repo would be ~${formatTokens(everything)}.`);
  if (global.tokens) {
    const where = global.folders.map((folder) => `${folder.path} (${folder.skills})`).join(", ");
    console.log(`Global skills add ~${formatTokens(global.tokens)} tokens to every session in every repo, with or without stackfit: ${where}.`);
    console.log("Skills that also live in the catalog can be removed from those folders once their packs cover the repos that need them.");
  } else {
    console.log("No global skill folders found (~/.claude/skills, ~/.agents/skills, ~/.cursor/skills, ~/.codex/skills).");
  }
  console.log("Estimates: skill names + descriptions and always-on rules, about 4 characters per token. Skill bodies load only when used; manual-only skills cost 0.");
}
