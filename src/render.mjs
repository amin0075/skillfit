// Text transforms between the catalog format and each agent's expected files.

// Minimal YAML frontmatter editing for top-level scalar keys; enough for upstream overrides.
export function setFrontmatter(content, fields) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const lines = match ? match[1].split(/\r?\n/) : [];
  const body = match ? content.slice(match[0].length) : content;
  const isKey = (line) => /^[A-Za-z][\w-]*:/.test(line);
  for (const [key, value] of Object.entries(fields)) {
    const start = lines.findIndex((line) => line.startsWith(`${key}:`));
    let end = start + 1;
    if (start !== -1) while (end < lines.length && !isKey(lines[end])) end += 1;
    const rendered = value === null ? [] : [`${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`];
    if (start === -1) lines.push(...rendered);
    else lines.splice(start, end - start, ...rendered);
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// Reads top-level keys, joining folded/literal block scalars (`description: >-`).
export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fields: {}, body: content };
  const fields = {};
  let current = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) {
      current = field[1];
      fields[current] = field[2].trim().replace(/^['"]|['"]$/g, "");
    } else if (current && /^\s+\S/.test(line)) {
      fields[current] = `${fields[current].replace(/^[>|]-?$/, "")} ${line.trim()}`.trim();
    }
  }
  return { fields, body: content.slice(match[0].length).replace(/^\r?\n/, "") };
}

// Split a Cursor `globs` value on commas that are not inside `{...}`.
export function splitGlobs(value) {
  const globs = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      globs.push(current);
      current = "";
    } else current += char;
  }
  globs.push(current);
  return globs.map((glob) => glob.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

// Cursor .mdc → Claude Code .claude/rules/*.md. Always-apply rules load every session;
// glob rules become `paths:`; description-only rules stay routed through AGENTS.md.
export function claudeRule(content) {
  const { fields, body } = parseFrontmatter(content);
  if (fields.alwaysApply === "true") return body;
  if (fields.globs) {
    const paths = splitGlobs(fields.globs).map((glob) => `  - ${JSON.stringify(glob)}`).join("\n");
    return `---\npaths:\n${paths}\n---\n\n${body}`;
  }
  return null;
}

export function cursorRule(content, name) {
  if (content.startsWith("---\n")) return content;
  return `---\ndescription: Repository-specific ${name} guidance; read when relevant\nalwaysApply: false\n---\n\n${content}`;
}

// Claude Code treats commands as skills; keep side-effecting workflows manual-only.
export function claudeCommand(content) {
  if (/^---\r?\n/.test(content)) return content;
  const summary = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) ?? "";
  return `---\ndescription: ${JSON.stringify(summary.slice(0, 200))}\ndisable-model-invocation: true\n---\n\n${content}`;
}

export function claudeAgent(content) {
  return content.replace(/^model:\s*.+$/m, "model: inherit").replace(/^readonly:\s*true$/m, "permissionMode: plan");
}

// Effective skill metadata = SKILL.md frontmatter + render overrides from skill-sources.json.
export function effectiveMetadata(skillContent, overrides = {}) {
  const { fields } = parseFrontmatter(skillContent);
  return { ...fields, ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, String(value)])) };
}

// Characters of a skill that sit in every session: its name + description, unless manual-only.
export function listingCost(metadata, name) {
  if (!metadata || metadata["disable-model-invocation"] === "true") return 0;
  return (metadata.description?.length ?? 0) + name.length;
}
