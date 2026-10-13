# rev-skills — Skill Authoring Specification

> Version 0.1.0 · This file is the single source of truth for every skill in this repository.
> If you are writing a new skill, read this file completely before you write a single line.

---

## 0. Repository philosophy

Most "agent skills" repositories are prompt collections. Nobody can tell whether they work.
This repository is different, and the difference is enforced by CI:

**Every skill must be falsifiable.** Each one ships with a fixture, a declared expected
result, and a `verify.sh` that a stranger can run to see whether the skill actually
does what its description claims.

A skill that cannot be verified does not belong in this repository.

Three rules follow from that, and they are non-negotiable:

1. **Evidence over assertion.** Every factual statement in a skill's output template must
   be traceable to a command, a string, a symbol, or an address.
2. **No verdicts.** The skill reports observations. It never declares "this is malware",
   "this is cracked", or "this is safe". Judgment belongs to the human analyst.
3. **Legal surface is fixed.** Fixtures are self-built or public open-source software.
   See §7.

---

## 1. Directory layout

```
rev-skills/
├── SPEC.md                       ← this file
├── README.md                     ← English
├── README.zh-CN.md               ← Simplified Chinese
├── build.mjs                     ← platform format generator (Node, no deps)
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md              ← REQUIRED · the skill definition
│       ├── expected.md           ← REQUIRED · what correct output looks like
│       ├── verify.sh             ← REQUIRED · exit 0 = skill is wired up correctly
│       ├── fixtures/
│       │   ├── build.sh          ← generates fixture artifacts (POSIX)
│       │   ├── build.ps1         ← generates fixture artifacts (Windows)
│       │   ├── src/              ← fixture SOURCE ONLY — no binaries in git
│       │   └── README.md         ← what each fixture is, and its known ground truth
│       └── references/           ← OPTIONAL · deeper material, loaded on demand
│           └── *.md
├── bench/
│   ├── run_bench.mjs
│   └── results.md                ← generated; do not hand-edit
├── docs/
│   └── legal.md                  ← fixture provenance policy
└── .github/workflows/
    ├── verify.yml
    └── bench.yml
```

**Rule 1.1** — Skill directory name is kebab-case and must equal the `name` field.

**Rule 1.2** — A skill directory contains at most 4 top-level files. Anything more goes
into `references/`. Skills are loaded into an agent's context; size is a cost.

**Rule 1.3** — `SKILL.md` body must stay under 500 lines. If you need more, split into
`references/` and tell the reader *when* to load which file.

---

## 2. Frontmatter — the neutral schema

`SKILL.md` frontmatter is **platform-neutral**. `build.mjs` converts it into whatever each
target platform wants. Do not put any platform-specific keys here.

```yaml
---
name: binary-triage
description: One sentence. Says WHAT it does and WHEN to use it. Under 500 chars.
version: 0.1.0
tags: [triage, elf, pe, static-analysis]
tools: [bash, read, grep, glob]
references:
  - file: references/entropy.md
    when: when the target shows uniform high entropy and you need the detection thresholds
---
```

### Field rules

| Field | Required | Rule |
|---|---|---|
| `name` | yes | kebab-case, must equal directory name, `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `description` | yes | ≤ 500 chars, single logical sentence. **Must contain a trigger condition.** Write it as "does X. Use when Y." — a description with no trigger will never be loaded by an agent. |
| `version` | yes | semver |
| `tags` | yes | 2–6 lowercase tags |
| `tools` | yes | only from the allowed vocabulary in §3.2 |
| `requires` | yes | external commands the skill's steps invoke. Checked by `verify.sh`. List every binary the body calls — a missing one is a real defect, not a warning. |
| `references` | no | list of `{file, when}` — `when` is mandatory if `references` exists |

**Rule 2.1** — The `description` is the only thing an agent sees before deciding to load
the skill. If a reader cannot tell from the description alone whether this skill applies
to their situation, the description is wrong.

**Rule 2.2** — Do not repeat frontmatter values in the body. The body starts with `# Title`.

---

## 3. SKILL.md body — six mandatory sections

Every `SKILL.md` contains exactly these sections, in this order. Nothing else at the top level.

```markdown
# <Human-readable title>

## Objective
## Execution
## Output format
## Hard constraints
## Failure handling
## Verification
```

### 3.1 Section requirements

**`## Objective`** — 2–4 lines. What the analyst gets out of this skill, and what this
skill deliberately does *not* attempt. Name the boundary of scope explicitly.

**`## Execution`** — Numbered steps. Each step:

- states the **goal** of the step in one line,
- gives the **exact command** to run,
- states **what to look for** in the output, and what each finding means.

Commands use shell variables in `UPPER_SNAKE` declared once at the top of the section:

```bash
TARGET="${TARGET:-./target.bin}"
```

Never write a step whose action is "analyze" or "review" without a command attached.
A step a machine cannot execute is not a step.

**`## Output format`** — A literal fenced block showing the exact report shape. Skills
produce structured, stable output. Prose narration is forbidden; the block is a contract.

Include a confidence field wherever a conclusion is inferred rather than observed, with
the vocabulary fixed to `high | medium | low`.

**`## Hard constraints`** — Bullet list. Always includes the four standing constraints
(§3.3) plus anything skill-specific.

**`## Failure handling`** — A table of `Symptom | Cause | Fallback`. Every step that can
fail must appear here. Typical entries: tool missing, permission denied, target is packed,
output is empty.

**`## Verification`** — One command: how to run this skill's own `verify.sh`, and what a
passing run prints.

### 3.2 Allowed `tools` vocabulary

```
bash    read    grep    glob    write    edit    web     browser
```

Anything outside this list must be justified in `## Hard constraints`. Do not invent
tool names — an unknown tool name causes the skill to be silently rejected on some hosts.

### 3.3 Standing hard constraints (include verbatim in every skill)

```markdown
- Report observations and their evidence. Never emit a verdict such as "this is malware",
  "this is safe", "this is cracked", or "this is malicious". Classification is the analyst's call.
- Every claim in the output must cite its evidence: a matched string, a symbol name, a
  section name, a file offset, or an address. Uncited claims must be dropped.
- Do not introduce network access, downloads, or external service calls unless the step
  explicitly declares it and prints what it is about to fetch before fetching it.
- Operate only on the target the user supplied or on this skill's own fixtures.
```

### 3.4 Writing style

- Imperative mood. "Run X." not "You could run X."
- No filler: no "basically", "note that", "it's important to", "in order to".
- Concrete over general: `readelf -h` beats "inspect the headers".
- Every threshold is a number. "High entropy" is forbidden; `ENTROPY > 7.2` is required.
- English body. Localized README is a separate concern (Rule 6.1).

---

## 4. Fixtures

A fixture is a small artifact with **known ground truth**, built from source at test time.

### Rules

**Rule 4.1** — Fixture artifacts are **not** committed as binaries. Only sources and build
scripts. `fixtures/src/` holds `.c` / `.py` / `.js` / `.json` inputs.

**Rule 4.2** — `fixtures/README.md` lists, for each fixture: what it is, how it is built,
and the **exact ground-truth facts** a correct analysis must recover. Example:

| Fixture | Ground truth |
|---|---|
| `clean_elf` | x86-64 ELF, not stripped, contains symbol `planted_marker_fn`, links libc |
| `stripped_elf` | same binary after `strip`, identical hash of `.text`, no symtab |
| `packed_like` | x86-64 ELF with a 64 KiB segment at entropy ≥ 7.9 |

**Rule 4.3** — A fixture must be buildable with tooling that is already present on a stock
developer machine: `gcc`, `strip`, `node`, `bash`. If a fixture needs a heavier tool
(jadx, frida, binwalk, radare2), the fixture is marked **`optional`**, `verify.sh` skips
it when the tool is missing, and the skip is reported rather than silently passing.

**Rule 4.4** — Never commit a sample you did not build or that is not public open-source
software with a known analysis. No real malware, no commercial binaries, no cracks.

---

## 5. Verification contract

`verify.sh` answers exactly one question: **is this skill correctly wired up?**

It does **not** answer "is the AI good at this task" — that is `bench/`.

### Requirements

**Rule 5.1** — `verify.sh` is POSIX `sh`, `set -eu`, and exits 0 on pass, non-zero on fail.

**Rule 5.2** — It must be runnable from the skill's own directory with no arguments:
`cd skills/binary-triage && sh verify.sh`

**Rule 5.3** — It checks, at minimum, all of:

1. `SKILL.md` exists and has valid frontmatter with a non-empty `description` containing
   a trigger word (`when`, `use when`, or `if the user`).
2. Every file listed in `references:` exists on disk.
3. Every `tools:` entry is in the allowed vocabulary (§3.2).
4. Every command named in `requires:` resolves on this machine.
5. Every fixture named in `expected.md` exists or can be built.
6. The six mandatory sections are all present, in order.

**Rule 5.4** — `verify.sh` must print a per-check pass/fail line, then a final summary.
A verifier that only prints "OK" is not acceptable; a human has to be able to see what
was checked.

**Rule 5.5** — `verify.sh` must be fast: under 10 seconds with fixtures already built.

Exact expected output shape:

```
[1/6] SKILL.md frontmatter ................. PASS
[2/6] references resolve ................... PASS (0 declared)
[3/6] tools vocabulary ..................... PASS (bash read grep)
[4/6] command binaries available ........... PASS (gcc readelf strings)
[5/6] fixtures present ..................... PASS (3 built)
[6/6] mandatory sections in order .......... PASS

verify: 6/6 passed
```

On failure, the failing line prints `FAIL` plus one indented reason line, and the summary
becomes `verify: 4/6 passed` with a non-zero exit.

---

## 6. Localization

**Rule 6.1** — English is the language of `SKILL.md`, `expected.md`, code, commands, and
comments. There is exactly one localized artifact per repository: `README.zh-CN.md`.

Rationale: skills are consumed by models and by an international audience; a
double-maintained body rots within two releases.

**Rule 6.2** — Chinese is used in the README, the release notes, and `docs/`.
Terminology used in `README.zh-CN.md` should stay consistent with this table:

| English | 中文 |
|---|---|
| triage | 分诊 |
| fixture | 测试样本 |
| ground truth | 已知答案 |
| hard constraint | 硬约束 |
| packer / packed | 加壳 / 已加壳 |
| symbol recovery | 符号恢复 |
| stripping | 符号剥离 |
| report | 报告 |

---

## 7. Legal surface

**Rule 7.1** — Fixtures are built from source in this repository, or are public open-source
software with a published analysis. Provenance goes in `fixtures/README.md`.

**Rule 7.2** — No skill in this repository instructs bypassing a licence check, an
activation system, a DRM scheme, or a paywall. If a contributed skill's objective implies
that, the contribution is rejected. This is a scoping rule, not a moral position: such
skills cannot ship with a reproducible public fixture, so they cannot meet Rule 0.

**Rule 7.3** — `docs/legal.md` restates this in the form contributors read.

---

## 8. Review checklist (what a maintainer checks before merge)

- [ ] Directory name equals `name` in frontmatter
- [ ] `description` contains a trigger condition
- [ ] All six sections present, in the specified order, and nothing else at top level
- [ ] Every execution step has a runnable command
- [ ] Output format block is concrete and includes confidence vocabulary
- [ ] Standing hard constraints present verbatim
- [ ] `requires:` lists every external command the body invokes
- [ ] Fixture sources only; no binaries committed
- [ ] `fixtures/README.md` states ground truth for each fixture
- [ ] `verify.sh` runs clean from the skill directory and prints per-check lines
- [ ] `expected.md` matches what the skill actually emits
- [ ] Body under 500 lines
- [ ] `node build.mjs --check` passes for this skill

---

## 9. Adding a skill — procedure

```bash
mkdir -p skills/<name>/fixtures/src
cp skills/binary-triage/SKILL.md skills/<name>/SKILL.md   # start from the reference skill
# edit SKILL.md, write fixtures, write expected.md, write verify.sh
cd skills/<name> && sh verify.sh
cd ../.. && node build.mjs --check
```

`skills/binary-triage` is the **reference skill**. When this specification is ambiguous,
the reference skill is the tie-breaker. Do not modify it without bumping its `version`
and updating `expected.md`.
