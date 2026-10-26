import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "bin/skillfit.mjs");

export function run(args, { catalog, env = {}, cwd = root } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      SKILLFIT_CATALOG: catalog ?? "",
      SKILLFIT_LOCAL_CONFIG: "",
      ...env,
    },
  });
}

export async function writeTree(base, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(base, path)), { recursive: true });
    await writeFile(resolve(base, path), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

const skill = (name, description, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;

// A small catalog covering every feature: always/detected/opt-in packs, overrides, rules, commands, agents.
export async function makeCatalog(overrides = {}) {
  const catalog = await mkdtemp(resolve(tmpdir(), "skillfit-catalog-"));
  await writeTree(catalog, {
    "skillfit.json": {
      schemaVersion: 3,
      skills: ["base", "next-tips", "py-tips", "go-tips", "deep-research", "vendored", "workflow"],
      packs: {
        core: { always: true, skills: ["base", "vendored"] },
        nextjs: { detect: { dependencies: ["next"] }, skills: ["next-tips", "workflow"] },
        python: { detect: { dependencies: ["django"] }, skills: ["py-tips"] },
        go: { detect: { files: ["go.mod"] }, skills: ["go-tips"] },
        research: { skills: ["deep-research"] },
      },
      adapters: { agents: ["reviewer.md"], commands: ["handoff.md"], rules: ["general.mdc", "tests.mdc", "routed.mdc"] },
      ...overrides.registry,
    },
    "skill-sources.json": {
      schemaVersion: 2,
      skills: {
        base: { kind: "custom", reviewed: "2026-10-01" },
        "next-tips": { kind: "custom", reviewed: "2026-10-01" },
        "py-tips": { kind: "custom", reviewed: "2026-10-01" },
        "go-tips": { kind: "custom", reviewed: "2026-10-01" },
        "deep-research": { kind: "custom", reviewed: "2026-10-01" },
        workflow: { kind: "custom", reviewed: "2026-10-01" },
        vendored: {
          kind: "external",
          source: { repository: "https://github.com/example/skills.git", path: "skills/upstream-name" },
          reviewed: "2026-10-01",
          render: { frontmatter: { name: "vendored", description: "Short local description." }, exclude: ["AGENTS.md"] },
        },
      },
    },
    "skills/base/SKILL.md": skill("base", "Base engineering defaults for every repo."),
    "skills/next-tips/SKILL.md": skill("next-tips", "Next.js tips."),
    "skills/py-tips/SKILL.md": skill("py-tips", "Django tips."),
    "skills/go-tips/SKILL.md": skill("go-tips", "Go tips."),
    "skills/deep-research/SKILL.md": skill("deep-research", "A large opt-in research skill."),
    "skills/workflow/SKILL.md": skill("workflow", "A long manual workflow.", "disable-model-invocation: true\n"),
    "skills/vendored/SKILL.md": skill("upstream-name", "A very long upstream description that nobody wants in every session's context because it goes on and on."),
    "skills/vendored/AGENTS.md": "compiled duplicate\n",
    "rules/general.mdc": "---\ndescription: Defaults\nalwaysApply: true\n---\n\n# General\n\nBe careful.\n",
    "rules/tests.mdc": "---\ndescription: Tests\nglobs: \"**/*.{test,spec}.{ts,tsx}\"\nalwaysApply: false\n---\n\n# Tests\n",
    "rules/routed.mdc": "---\ndescription: Only when asked\nalwaysApply: false\n---\n\n# Routed\n",
    "commands/handoff.md": "# handoff\n\nSummarise the work and tag {{env:REVIEWER_HANDLE}} for review.\n",
    "agents/reviewer.md": "---\nname: reviewer\nmodel: fast\nreadonly: true\n---\n\nReview the repository.\n",
    ...overrides.files,
  });
  return catalog;
}

export async function makeProject(files = {}) {
  const project = await mkdtemp(resolve(tmpdir(), "skillfit-project-"));
  await mkdir(resolve(project, ".git"));
  await writeTree(project, files);
  return project;
}
