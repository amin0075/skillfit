import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { makeCatalog, makeProject, run, writeTree } from "./helpers.mjs";

const posix = (path) => path.replaceAll("\\", "/");
const read = (path) => readFile(path, "utf8");

test("init creates tracked project context without overwriting", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject();
  try {
    assert.equal(run(["init", "--project", project], { catalog }).status, 0);
    assert.equal(await read(resolve(project, "CLAUDE.md")), "@AGENTS.md\n");
    assert.ok(existsSync(resolve(project, "docs/agent/config.json")));
    await writeFile(resolve(project, "docs/agent/index.md"), "custom\n");
    assert.equal(run(["init", "--project", project], { catalog }).status, 0);
    assert.equal(await read(resolve(project, "docs/agent/index.md")), "custom\n");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("sync renders skills, rules, commands, and agents for Cursor and Claude Code", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject({
    "docs/agent/config.json": { schemaVersion: 1 },
    "docs/agent/skills/local-example/SKILL.md": "---\nname: local-example\ndescription: Local.\n---\n",
    "docs/agent/rules/design.md": "# Design\n",
    "docs/agent/commands/local-check.md": "Run the checks.\n",
  });
  try {
    const result = run(["sync", "--project", project], { catalog, env: { REVIEWER_HANDLE: "@reviewer" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /packs: core/);
    for (const target of [".claude/skills", ".cursor/skills"]) {
      assert.ok((await lstat(resolve(project, target))).isSymbolicLink());
      assert.ok(posix(await readlink(resolve(project, target))).endsWith(".agents/skills"));
      assert.ok(existsSync(resolve(project, target, "local-example/SKILL.md")));
    }
    assert.ok(existsSync(resolve(project, ".agents/skills/base/SKILL.md")));
    assert.ok(!existsSync(resolve(project, ".agents/skills/next-tips")), "undetected pack is not synced");

    const vendored = await read(resolve(project, ".agents/skills/vendored/SKILL.md"));
    assert.match(vendored, /name: "vendored"/);
    assert.match(vendored, /Short local description/);
    assert.ok(!existsSync(resolve(project, ".agents/skills/vendored/AGENTS.md")), "render.exclude applies");

    assert.doesNotMatch(await read(resolve(project, ".claude/rules/general.md")), /alwaysApply/);
    assert.match(await read(resolve(project, ".claude/rules/tests.md")), /paths:\n {2}- "\*\*\/\*\.\{test,spec\}\.\{ts,tsx\}"/);
    assert.ok(!existsSync(resolve(project, ".claude/rules/routed.md")), "description-only rules stay routed");
    assert.ok(existsSync(resolve(project, ".cursor/rules/routed.mdc")));
    assert.ok(existsSync(resolve(project, ".cursor/rules/design.mdc")));

    assert.match(await read(resolve(project, ".cursor/commands/handoff.md")), /@reviewer/, "env placeholders are filled");
    assert.match(await read(resolve(project, ".claude/commands/handoff.md")), /disable-model-invocation: true/);
    assert.match(await read(resolve(project, ".claude/commands/local-check.md")), /disable-model-invocation: true/);
    const agent = await read(resolve(project, ".claude/agents/reviewer.md"));
    assert.match(agent, /model: inherit/);
    assert.match(agent, /permissionMode: plan/);

    assert.match(await read(resolve(project, ".git/info/exclude")), /\.stackfit\.lock\.json/);
    const again = run(["status", "--project", project, "--check"], { catalog, env: { REVIEWER_HANDLE: "@reviewer" } });
    assert.equal(again.status, 0, again.stdout);
    assert.match(again.stdout, /up to date/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("catalog .env fills placeholders and missing variables only warn", async () => {
  const catalog = await makeCatalog({ files: { ".env": "REVIEWER_HANDLE=@from-dotenv\n" } });
  const project = await makeProject();
  try {
    const result = run(["sync", "--project", project], { catalog });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await read(resolve(project, ".cursor/commands/handoff.md")), /@from-dotenv/);
    await rm(resolve(catalog, ".env"));
    const missing = run(["status", "--project", project], { catalog });
    assert.match(missing.stderr, /REVIEWER_HANDLE is not set/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("packs are detected across ecosystems and pruned when excluded", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject({
    "web/package.json": { dependencies: { next: "16.4.0" } },
    "api/requirements.txt": "Django>=5.0\nrequests==2.32\n",
    "worker/go.mod": "module example.com/worker\n\ngo 1.23\n",
    "docs/agent/config.json": { schemaVersion: 1 },
  });
  try {
    const first = run(["sync", "--project", project], { catalog });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /packs: core, nextjs, python, go/);
    for (const name of ["next-tips", "workflow", "py-tips", "go-tips"]) assert.ok(existsSync(resolve(project, ".agents/skills", name, "SKILL.md")), name);
    assert.ok(!existsSync(resolve(project, ".agents/skills/deep-research")), "opt-in pack is not auto-detected");

    await writeTree(project, { "docs/agent/config.json": { schemaVersion: 1, excludePacks: ["python"], packs: ["research"] } });
    const second = run(["sync", "--project", project], { catalog });
    assert.equal(second.status, 0, second.stderr);
    assert.ok(!existsSync(resolve(project, ".agents/skills/py-tips")), "dropped skill folder is pruned");
    assert.ok(existsSync(resolve(project, ".agents/skills/deep-research/SKILL.md")));

    await writeTree(project, { "docs/agent/config.json": { schemaVersion: 1, packs: ["nope"] } });
    const unknown = run(["sync", "--project", project], { catalog });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown pack 'nope'/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("repo-owned components need an explicit override to replace shared ones", async () => {
  const catalog = await makeCatalog();
  const local = "---\nname: base\ndescription: Repository override.\n---\n";
  const project = await makeProject({ "docs/agent/skills/base/SKILL.md": local, "docs/agent/config.json": { schemaVersion: 1 } });
  try {
    const blocked = run(["sync", "--project", project], { catalog });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /conflicts with shared skills/);
    await writeTree(project, { "docs/agent/config.json": { schemaVersion: 1, overrides: { skills: ["base"] } } });
    assert.equal(run(["sync", "--project", project], { catalog }).status, 0);
    assert.equal(await read(resolve(project, ".agents/skills/base/SKILL.md")), local);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("sync refuses to overwrite unmanaged files", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject({ ".cursor/rules/general.mdc": "my own rule\n" });
  try {
    const result = run(["sync", "--project", project], { catalog });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unmanaged collision/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("agent-config projects migrate: legacy lock and .claude/commands symlink", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject({ ".cursor/commands/handoff.md": "old\n" });
  await mkdir(resolve(project, ".claude"), { recursive: true });
  await symlink("../.cursor/commands", resolve(project, ".claude/commands"), "dir");
  await writeTree(project, {
    ".agent-config.lock.json": { schemaVersion: 2, files: { ".cursor/commands/handoff.md": "old" }, links: { ".claude/commands": "../.cursor/commands" } },
  });
  try {
    const result = run(["sync", "--project", project], { catalog });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(await lstat(resolve(project, ".claude/commands"))).isSymbolicLink());
    assert.ok(existsSync(resolve(project, ".stackfit.lock.json")));
    assert.ok(!existsSync(resolve(project, ".agent-config.lock.json")), "legacy lock is replaced");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("--all selects projects from the matching machine profile, with per-project packs", async () => {
  const catalog = await makeCatalog();
  const workspace = await makeProject();
  for (const name of ["app-one", "app-two", "other"]) await mkdir(resolve(workspace, "code", name, ".git"), { recursive: true });
  const localConfig = resolve(workspace, "stackfit.local.json");
  await writeTree(workspace, {
    "stackfit.local.json": {
      schemaVersion: 1,
      machines: [
        { id: "win", match: { platform: "win32", hostname: "box" }, roots: [resolve(workspace, "code")], projects: ["app-one", "app-two"] },
        { id: "mac", match: { platform: "darwin" }, roots: [resolve(workspace, "code")], projects: [{ name: "app-two", scaffold: false, packs: ["research"] }] },
      ],
    },
  });
  try {
    const env = { STACKFIT_LOCAL_CONFIG: localConfig };
    const win = run(["status", "--all"], { catalog, env: { ...env, STACKFIT_PLATFORM: "win32", STACKFIT_HOSTNAME: "box" } });
    assert.equal(win.status, 0, win.stderr);
    assert.match(win.stdout, /machine: win/);
    assert.match(win.stdout, /app-one:/);
    assert.doesNotMatch(win.stdout, /other:/);
    const mac = run(["sync", "--all"], { catalog, env: { ...env, STACKFIT_PLATFORM: "darwin" } });
    assert.equal(mac.status, 0, mac.stderr);
    assert.match(mac.stdout, /app-two: .*\[adapter-only\]/);
    assert.match(mac.stdout, /packs: core, research/);
    assert.match(await read(resolve(workspace, "code/app-two/.git/info/exclude")), /docs\/agent\//);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("report shows context per project and status --check fails on drift", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject({ "package.json": { dependencies: { next: "16.4.0" } } });
  try {
    const report = run(["report", "--project", project, "--json"], { catalog });
    assert.equal(report.status, 0, report.stderr);
    const [row] = JSON.parse(report.stdout).projects;
    assert.deepEqual(row.packs, ["core", "nextjs"]);
    assert.equal(row.skills, 4);
    assert.ok(row.tokens < row.tokensIfEverything);
    assert.ok(row.saved > 0);

    const drift = run(["status", "--project", project, "--check"], { catalog });
    assert.equal(drift.status, 1, "pending changes fail the check");

    const byRoot = run(["report", "--root", resolve(project, "..")], { catalog });
    assert.equal(byRoot.status, 0, byRoot.stderr);
    assert.match(byRoot.stdout, /per session/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("audit flags unvendored, stale, and unpacked skills", async () => {
  const catalog = await makeCatalog({
    registry: { skills: ["base", "next-tips", "py-tips", "go-tips", "deep-research", "vendored", "workflow", "missing-upstream", "loose"] },
    files: {
      "skills/loose/SKILL.md": "---\nname: loose\ndescription: Not in a pack.\n---\n",
    },
  });
  try {
    const sources = JSON.parse(await read(resolve(catalog, "skill-sources.json")));
    sources.skills["missing-upstream"] = { kind: "external", source: { repository: "https://github.com/x/y.git", path: "s" }, reviewed: "2026-10-01" };
    sources.skills.loose = { kind: "custom", reviewed: "2020-01-01" };
    await writeTree(catalog, { "skill-sources.json": sources });
    const result = run(["audit"], { catalog });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing-upstream: enabled but not vendored yet/);
    assert.match(result.stderr, /loose: last reviewed 2020-01-01/);
    assert.match(result.stderr, /loose: enabled but in no pack/);
  } finally {
    await rm(catalog, { recursive: true, force: true });
  }
});

test("catalog init --starter creates a valid catalog without personal content", async () => {
  const parent = await makeProject();
  const target = resolve(parent, "my-catalog");
  try {
    const result = run(["catalog", "init", target, "--starter"]);
    assert.equal(result.status, 0, result.stderr);
    for (const file of ["stackfit.json", "skill-sources.json", ".env.example", ".gitignore", "stackfit.local.example.json", "skills/next-server-security/SKILL.md"]) {
      assert.ok(existsSync(resolve(target, file)), file);
    }
    const audit = run(["audit"], { catalog: target });
    assert.match(audit.stderr, /not vendored yet; run `stackfit refresh/, "upstream skills are fetched by refresh");

    const empty = resolve(parent, "empty");
    assert.equal(run(["catalog", "init", empty]).status, 0);
    const emptyAudit = run(["audit"], { catalog: empty });
    assert.equal(emptyAudit.status, 0, emptyAudit.stderr);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a missing catalog gives a helpful error", async () => {
  const empty = await makeProject();
  try {
    const result = run(["status", "--project", empty], { cwd: empty, env: { HOME: empty, USERPROFILE: empty } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No catalog found/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("projects synced by the old skillfit name migrate their lock", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject();
  try {
    assert.equal(run(["sync", "--project", project], { catalog }).status, 0);
    const { rename } = await import("node:fs/promises");
    await rename(resolve(project, ".stackfit.lock.json"), resolve(project, ".skillfit.lock.json"));
    const again = run(["sync", "--project", project], { catalog });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /up to date/, "no false collisions from the old lock");
    assert.ok(existsSync(resolve(project, ".stackfit.lock.json")));
    assert.ok(!existsSync(resolve(project, ".skillfit.lock.json")));
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("git exclude covers only generated files, so the user's own .claude files stay visible", async () => {
  const { spawnSync } = await import("node:child_process");
  const catalog = await makeCatalog();
  const project = await makeProject();
  await rm(resolve(project, ".git"), { recursive: true, force: true });
  spawnSync("git", ["init", "-q", project]);
  await writeTree(project, {
    ".git/info/exclude": "# my own ignore\n*.log\n# Managed locally by agent-config\n.agent-config.lock.json\n.agents/\n.cursor/\n.claude/\n",
  });
  const ignored = (path) => spawnSync("git", ["-C", project, "check-ignore", "-q", path]).status === 0;
  try {
    const result = run(["sync", "--project", project], { catalog });
    assert.equal(result.status, 0, result.stderr);
    const exclude = await read(resolve(project, ".git/info/exclude"));
    assert.match(exclude, /\*\.log/, "user lines are kept");
    assert.doesNotMatch(exclude, /^\.claude\/$/m, "legacy whole-folder lines are removed");
    assert.doesNotMatch(exclude, /Managed locally by/);

    await writeTree(project, { ".claude/settings.json": "{}\n" });
    assert.equal(ignored(".claude/settings.json"), false, "user's own file is visible to git");
    assert.equal(ignored(".claude/rules/general.md"), true);
    assert.equal(ignored(".claude/skills"), true);
    assert.equal(ignored(".agents/skills/base/SKILL.md"), true);
    assert.equal(ignored(".stackfit.lock.json"), true);

    const again = run(["sync", "--project", project], { catalog });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await read(resolve(project, ".git/info/exclude")), exclude, "the managed block is stable");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(catalog, { recursive: true, force: true });
  }
});

test("report counts always-on rules and shows global skills as a baseline", async () => {
  const catalog = await makeCatalog();
  const project = await makeProject();
  const home = await makeProject({
    ".claude/skills/old-global/SKILL.md": "---\nname: old-global\ndescription: A global skill that loads in every repo.\n---\n",
    ".claude/skills/not-a-skill/notes.txt": "ignored\n",
  });
  try {
    const env = { HOME: home, USERPROFILE: home };
    const result = run(["report", "--project", project, "--json"], { catalog, env });
    assert.equal(result.status, 0, result.stderr);
    const { projects: [row], global } = JSON.parse(result.stdout);
    assert.ok(row.ruleTokens > 0, "alwaysApply rule is counted");
    assert.equal(row.tokens, row.listingTokens + row.ruleTokens);
    assert.equal(row.skills, 2);
    assert.deepEqual(global.folders.map((folder) => [folder.path, folder.skills]), [["~/.claude/skills", 1]]);
    assert.ok(global.tokens > 0);
    const text = run(["report", "--project", project], { catalog, env });
    assert.match(text.stdout, /Global skills add ~\d+ tokens to every session/);
  } finally {
    for (const path of [project, catalog, home]) await rm(path, { recursive: true, force: true });
  }
});

test("the starter ships the same stackfit skill as skills/stackfit", async () => {
  const { readdir } = await import("node:fs/promises");
  const list = async (dir) => (await readdir(dir, { recursive: true })).sort();
  const a = resolve(import.meta.dirname, "../skills/stackfit");
  const b = resolve(import.meta.dirname, "../starter/skills/stackfit");
  assert.deepEqual(await list(b), await list(a));
  for (const file of await list(a)) {
    if (file.endsWith(".md")) assert.equal(await read(resolve(b, file)), await read(resolve(a, file)), file);
  }
});
