# rev-skills

**Binary analysis skills for AI agents — with a way to check that they work.**

An agent that can read your source code is not the same as an agent that can read a binary
you have no source for. These skills close that gap.

![skills](https://img.shields.io/badge/skills-1%20verified-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![dependencies](https://img.shields.io/badge/runtime%20deps-none-lightgrey)

> **Early.** One skill is implemented and verified end to end; eleven more are planned — see
> [Skills](#skills). The infrastructure every skill runs on is finished and tested.

---

## The gap

Ask an agent to explain a repository and it does well. Hand it a 40 MB stripped binary and
it produces confident prose with nothing behind it: it guesses at the architecture, calls
anything with high entropy "packed", and writes a summary that sounds like analysis without
containing any.

The problem is not capability. It is that nothing in the prompt says *what to run, in what
order, and what the output means*. That is what a skill is.

## What a skill is here

A directory with four things:

```
skills/binary-triage/
├── SKILL.md       a bounded procedure: numbered steps, exact commands, fixed output shape
├── expected.md    what a correct run produces, and which wrong answers look plausible
├── verify.sh      one command that checks the skill is wired up correctly
└── fixtures/      sources for samples with known ground truth
```

`SKILL.md` is the part an agent reads. The other three are why you can trust it.

---

## Why these are checkable

Most agent-skill repositories are prompt collections. You cannot tell whether a skill works,
and neither can the author. Three mechanisms fix that here:

### 1. Fixtures carry known answers

Every skill builds its own test samples from source and records the ground truth in plain
text. `binary-triage` ships three:

| Fixture | Ground truth |
|---|---|
| `triage_clean` | normal, unstripped, 1021 symbols, no section above entropy 7.0 |
| `triage_stripped` | same code after `strip` — **0 symbols**, but the marker string survives |
| `triage_packed` | a `.blob` section at **7.995** entropy, while `.text` sits at **6.252** |

The third is the interesting one. It is not packed. It exists to catch the two most common
failure modes at once: shouting "packed!" at any high-entropy section, and scoring the whole
file instead of localising — the whole-file figure for that binary is **6.399**, which
crosses no threshold at all.

### 2. `verify.sh` runs in ten seconds

```bash
cd skills/binary-triage && sh verify.sh
```

```
[1/6] SKILL.md frontmatter                     PASS (name+desc+version+tags+tools)
[2/6] references resolve                       PASS (1 declared)
[3/6] tools vocabulary                         PASS (bash read grep glob)
[4/6] declared requirements available          PASS (14 checked, all found)
[5/6] fixtures present                         PASS (3 built)
[6/6] mandatory sections in order              PASS (6/6)

verify: 6/6 passed
```

CI runs this for every skill on every pull request. A skill that does not pass does not
merge.

### 3. `expected.md` names the wrong answers

A skill's expected output does not just describe success. It lists the specific plausible
errors and what they indicate:

| Failure | What it means |
|---|---|
| `triage_packed` reported as `confirmed` | applied a threshold without reading the evidence |
| `triage_stripped` reported as not stripped | counted the export table and mistook it for debug symbols |
| `triage_stripped` yields no signals | believes stripping removes data; it removes names |
| `.text` listed as the dense section | skipped the per-section read entirely |

That is what makes a claim falsifiable. Run the skill, read the output, check the table.

---

## A real run

Verbatim output of `binary-triage` against its own `triage_packed` fixture:

```
TARGET       triage_packed  86cacc0d227d0b80
FORMAT       pe  x86-64  64  little  dynamic
SIZE         115926
TOOLCHAIN    c  confidence=high
STRIPPED     no  symbols=1022  exports=7
PACKING      none  max_section=.blob@7.995  kind=data
PACKER_HINT  none
LAYOUT       sections=17  wx_sections=0  anomalies=.blob is a dense read-only data section
NETWORK      0
CREDENTIALS  none
IMPORTS      none
SIGNALS      Section .blob entropy 7.995 over 32768 bytes — dense read-only data
             Executable section .text entropy 6.252 — no unpacker stub, code is readable
             Marker literal recovered — "REVSKILLS_MARKER_PACKED_v1" in .rodata
NEXT         decompile-bytecode
```

The call that matters is in the last line. A threshold-following agent sees 7.995, says
"packed", and hands back `NEXT unpack-first` — sending an analyst to spend an hour on a file
whose code was readable the whole time.

---

## Install

Skills are plain markdown. Pick the format for your harness; `node build.mjs` generates all
of them from the same source.

| Harness | Output | Where it goes |
|---|---|---|
| Claude Code / Skills | `dist/claude/<name>/SKILL.md` | your skills directory |
| Codex | `dist/codex/AGENTS.md` | repository root |
| Cursor | `dist/cursor/<name>.mdc` | `.cursor/rules/` |
| Anything else | `dist/generic/<name>.md` | paste into the system prompt |

```bash
git clone https://github.com/xiebrooooo/rev-skills
cd rev-skills
node build.mjs            # no dependencies, Node 18+
```

Or take a single skill — each directory is self-contained and needs nothing from the rest of
the repository.

**Runtime requirements** are per skill and declared in its frontmatter. `binary-triage` needs
`file`, `strings`, `nm`, `objdump`, `readelf`, `node` — all standard.

---

## Skills

| Skill | Status | What it does |
|---|---|---|
| `binary-triage` | **verified** | profile an unknown binary: format, toolchain, packing, behavioural leads |
| `symbol-recovery` | planned | recover function and structure names from a stripped binary |
| `decompile-navigate` | planned | find the logic that matters in tens of thousands of decompiler lines |
| `unpack-custom` | planned | identify and handle common packers and obfuscators |
| `version-diff` | planned | diff two builds and surface behavioural change |
| `frida-hook-gen` | planned | generate Frida hooks for a running target |
| `syscall-triage` | planned | reconstruct behaviour from a syscall trace |
| `apk-audit` | planned | Android manifest, component exposure, hardcoded secrets, packer detection |
| `pinning-bypass` | planned | identify and defeat certificate pinning |
| `malware-triage` | planned | fast triage of macros, PE and script samples into IOCs |
| `firmware-unpack` | planned | binwalk workflow and filesystem extraction |
| `re-report-writer` | planned | turn an analysis session into a report someone can act on |

The methodology is in [`SPEC.md`](SPEC.md). `binary-triage` is the reference implementation:
when the spec is ambiguous, it is the tie-breaker.

---

## Scope

These skills produce **observations with evidence**, never verdicts. No skill here declares
a sample malicious, safe, or cracked — classification is the analyst's call, and this is a
standing hard constraint in every `SKILL.md`.

Fixtures are built from source in this repository or taken from public open-source software
with a published analysis. No malware, no commercial binaries. See
[`docs/legal.md`](docs/legal.md).

## Contributing

Read [`SPEC.md`](SPEC.md), then start from `skills/binary-triage/`. The review checklist is
at the end of the spec. A skill that cannot be verified does not belong here — that is the
one rule everything else follows from.

## License

MIT. See [`LICENSE`](LICENSE).

---

[中文说明 →](README.zh-CN.md)
