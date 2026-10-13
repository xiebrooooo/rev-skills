#!/usr/bin/env node
/**
 * rev-skills build — one source definition, four platform outputs.
 *
 *   node build.mjs            generate dist/
 *   node build.mjs --check    validate only, non-zero exit on any violation
 *
 * No dependencies. Node 18+.
 *
 * Platform format drift is the reason this file exists: Claude Skills, Codex AGENTS.md,
 * Cursor .mdc rules and plain system prompts all want the same content in different
 * wrappers. Authors write SKILL.md once.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(ROOT, 'skills');
const DIST = path.join(ROOT, 'dist');

const CHECK_ONLY = process.argv.includes('--check');

const ALLOWED_TOOLS = new Set(['bash', 'read', 'grep', 'glob', 'write', 'edit', 'web', 'browser']);

const MANDATORY_SECTIONS = [
  '## Objective',
  '## Execution',
  '## Output format',
  '## Hard constraints',
  '## Failure handling',
  '## Verification',
];

const TRIGGER_WORDS = ['use when', 'when the user', 'when you', 'if the user', 'when a '];

// ---------------------------------------------------------------- frontmatter

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

/** Minimal YAML subset: scalar, inline array, block list of scalars, block list of maps. */
function parseFrontmatter(raw) {
  const out = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) { i++; continue; }

    const key = m[1];
    const val = m[2].trim();

    if (val === '') {
      const items = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const itemLines = [lines[i]];
        i++;
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s+-\s+/.test(lines[i])) {
          itemLines.push(lines[i]);
          i++;
        }
        items.push(parseBlockItem(itemLines));
      }
      out[key] = items.length ? items : undefined;
      continue;
    }

    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      i++;
      continue;
    }

    out[key] = unquote(val);
    i++;
  }
  return out;
}

function parseBlockItem(lines) {
  const first = lines[0].replace(/^\s*-\s+/, '');
  const mapRe = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;
  const fm = first.match(mapRe);
  if (!fm) return unquote(first.trim());

  const obj = { [fm[1]]: unquote(fm[2].trim()) };
  for (const raw of lines.slice(1)) {
    const m = raw.trim().match(mapRe);
    if (m) obj[m[1]] = unquote(m[2].trim());
    else if (Object.keys(obj).length) {
      const last = Object.keys(obj).at(-1);
      obj[last] = `${obj[last]} ${raw.trim()}`.trim();
    }
  }
  return obj;
}

function splitDocument(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: null, body: normalized, error: 'no frontmatter block' };
  return { frontmatter: parseFrontmatter(m[1]), body: normalized.slice(m[0].length) };
}

// ---------------------------------------------------------------- validation

function validateSkill(dirName, dir, doc) {
  const errors = [];
  const warnings = [];
  const fm = doc.frontmatter;

  if (!fm) return { errors: [`SKILL.md: ${doc.error}`], warnings, fm: null };

  for (const field of ['name', 'description', 'version', 'tags', 'tools', 'requires']) {
    if (!fm[field] || (Array.isArray(fm[field]) && fm[field].length === 0)) {
      errors.push(`frontmatter: missing required field "${field}"`);
    }
  }

  if (fm.name && fm.name !== dirName) {
    errors.push(`frontmatter: name "${fm.name}" does not match directory "${dirName}"`);
  }
  if (fm.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) {
    errors.push(`frontmatter: name "${fm.name}" is not kebab-case`);
  }
  if (fm.description) {
    if (fm.description.length > 500) {
      errors.push(`frontmatter: description is ${fm.description.length} chars, limit is 500`);
    }
    const lower = fm.description.toLowerCase();
    if (!TRIGGER_WORDS.some((w) => lower.includes(w))) {
      errors.push('frontmatter: description has no trigger condition (needs "use when" / "when the user" / "if the user")');
    }
  }
  if (Array.isArray(fm.tools)) {
    for (const t of fm.tools) {
      if (!ALLOWED_TOOLS.has(t)) errors.push(`frontmatter: tool "${t}" is outside the allowed vocabulary`);
    }
  }
  if (fm.references) {
    if (!Array.isArray(fm.references)) {
      errors.push('frontmatter: references must be a list of {file, when}');
    } else {
      for (const ref of fm.references) {
        if (typeof ref !== 'object' || !ref.file) {
          errors.push('frontmatter: each reference needs a "file"');
          continue;
        }
        if (!ref.when) errors.push(`frontmatter: reference "${ref.file}" has no "when" clause`);
        const refPath = path.join(dir, ref.file.replace(/\//g, path.sep));
        if (!fs.existsSync(refPath)) errors.push(`frontmatter: reference file not found: ${ref.file}`);
      }
    }
  }

  const lines = doc.body.split('\n');
  if (lines.length > 500) errors.push(`SKILL.md body is ${lines.length} lines, limit is 500`);

  const positions = [];
  for (const section of MANDATORY_SECTIONS) {
    const idx = lines.findIndex((l) => l.trim() === section);
    if (idx === -1) errors.push(`body: missing mandatory section "${section}"`);
    else positions.push({ section, idx });
  }
  for (let k = 1; k < positions.length; k++) {
    if (positions[k].idx < positions[k - 1].idx) {
      errors.push(`body: section "${positions[k].section}" appears before "${positions[k - 1].section}"`);
    }
  }

  const otherH2 = lines
    .filter((l) => /^##\s+/.test(l) && !MANDATORY_SECTIONS.includes(l.trim()))
    .map((l) => l.trim());
  if (otherH2.length) {
    warnings.push(`body: extra top-level sections present: ${otherH2.join(', ')}`);
  }

  if (!lines.some((l) => l.includes('```'))) {
    errors.push('body: no fenced command block found in Execution');
  }

  for (const required of ['expected.md', 'verify.sh', 'fixtures']) {
    if (!fs.existsSync(path.join(dir, required))) errors.push(`missing required path: ${required}`);
  }

  return { errors, warnings, fm };
}

// ---------------------------------------------------------------- generators

function yamlString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function claudeOutput(fm, body) {
  const lines = [
    '---',
    `name: ${fm.name}`,
    `description: ${fm.description}`,
    `allowed-tools: ${(fm.tools || []).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}`,
  ];
  for (const ref of fm.references || []) {
    lines.push(`# reference: ${ref.file} — load when ${ref.when}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

function cursorOutput(fm, body) {
  const tags = (fm.tags || []).join(', ');
  return [
    '---',
    `description: ${fm.description.replace(/"/g, "'")}`,
    `globs:`,
    'alwaysApply: false',
    `# tags: ${tags}`,
    '---',
    '',
    body,
  ].join('\n');
}

function genericOutput(fm, body) {
  const header = [
    `# Skill: ${fm.name}`,
    '',
    `**When to use:** ${fm.description}`,
    `**Tools:** ${(fm.tools || []).join(', ')}`,
    `**Version:** ${fm.version}`,
    '',
    '---',
    '',
  ].join('\n');
  return header + body;
}

function codexIndex(skills) {
  const parts = [
    '# rev-skills — Codex agent instructions',
    '',
    'Binary analysis capabilities for an AI agent. Each entry below is a skill: a bounded',
    'procedure with the exact commands to run. Load the full skill body from',
    '`dist/generic/<name>.md` before starting its procedure.',
    '',
    '## Available skills',
    '',
  ];
  for (const s of skills) {
    parts.push(`### ${s.fm.name}`, '', s.fm.description, '', `- Tags: ${(s.fm.tags || []).join(', ')}`, '');
  }
  parts.push(
    '## Standing constraints',
    '',
    '- Report observations with evidence. Never emit a malware/safe/cracked verdict.',
    '- Every claim cites a string, symbol, section name, offset, or address.',
    '- No network access unless the step declares it first.',
    '- Operate only on the supplied target or on this repository\'s own fixtures.',
    '',
  );
  return parts.join('\n');
}

// ---------------------------------------------------------------- main

function collectSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`error: skills directory not found at ${SKILLS_DIR}`);
    process.exit(2);
  }
  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const skills = [];
  let failed = 0;

  for (const name of dirs) {
    const dir = path.join(SKILLS_DIR, name);
    const skillPath = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      console.log(`✗ ${name}: SKILL.md not found`);
      failed++;
      continue;
    }
    const doc = splitDocument(fs.readFileSync(skillPath, 'utf8'));
    const { errors, warnings, fm } = validateSkill(name, dir, doc);

    if (errors.length) {
      console.log(`✗ ${name}`);
      for (const e of errors) console.log(`    ${e}`);
      failed++;
    } else {
      console.log(`✓ ${name}${warnings.length ? ` (${warnings.length} warning)` : ''}`);
      for (const w of warnings) console.log(`    ! ${w}`);
    }
    if (fm) skills.push({ name, dir, fm, body: doc.body });
  }

  return { skills, failed };
}

function emit(skills) {
  fs.rmSync(DIST, { recursive: true, force: true });
  for (const p of ['claude', 'cursor', 'generic', 'codex']) {
    fs.mkdirSync(path.join(DIST, p), { recursive: true });
  }

  for (const s of skills) {
    fs.mkdirSync(path.join(DIST, 'claude', s.name), { recursive: true });
    fs.writeFileSync(path.join(DIST, 'claude', s.name, 'SKILL.md'), claudeOutput(s.fm, s.body));
    fs.writeFileSync(path.join(DIST, 'cursor', `${s.name}.mdc`), cursorOutput(s.fm, s.body));
    fs.writeFileSync(path.join(DIST, 'generic', `${s.name}.md`), genericOutput(s.fm, s.body));
  }

  fs.writeFileSync(path.join(DIST, 'codex', 'AGENTS.md'), codexIndex(skills));

  const index = {
    generatedFrom: 'skills/*/SKILL.md',
    count: skills.length,
    skills: skills.map((s) => ({
      name: s.fm.name,
      version: s.fm.version,
      description: s.fm.description,
      tags: s.fm.tags || [],
      tools: s.fm.tools || [],
      outputs: {
        claude: `claude/${s.name}/SKILL.md`,
        cursor: `cursor/${s.name}.mdc`,
        generic: `generic/${s.name}.md`,
      },
    })),
  };
  fs.writeFileSync(path.join(DIST, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  console.log(`\ndist/ written: ${skills.length} skills x 3 formats + codex/AGENTS.md + index.json`);
}

function main() {
  const { skills, failed } = collectSkills();
  console.log('');
  if (failed) {
    console.error(`build: FAILED — ${failed} skill(s) invalid`);
    process.exit(1);
  }
  if (skills.length === 0) {
    console.error('build: no skills found');
    process.exit(1);
  }
  if (CHECK_ONLY) {
    console.log(`check: OK — ${skills.length} skill(s) valid (dist/ not written)`);
    return;
  }
  emit(skills);
}

main();
