---
name: binary-triage
description: Triage an unknown binary in one pass and report its format, toolchain, packing state, and behavioural leads without opening a disassembler. Use when the user supplies an unfamiliar executable, shared library, or firmware blob and asks what it is, what it does, or where to start.
version: 0.1.0
tags: [triage, elf, pe, static-analysis]
tools: [bash, read, grep, glob]
requires: [file, strings, nm, objdump, readelf, grep, awk, sed, sort, head, wc, uniq, node, sha256sum]
references:
  - file: references/entropy.md
    when: the target shows a large uniform high-entropy region and you need the detection thresholds and the known false-positive cases
---

# Binary Triage

## Objective

Produce a decision-ready profile of a binary nobody has looked at yet: what it is, what
built it, whether it is obfuscated, and which analysis route is worth the next hour.

This skill covers **static identification only**. It does not decompile, does not execute
the target, and does not attribute the sample to any actor or family. When the profile says
`NEXT: decompile-bytecode`, that is the handoff point to a heavier skill.

## Execution

Declare the target once. Everything below reads from `$TARGET`.

```bash
TARGET="${TARGET:-./fixtures/build/triage_clean}"
```

### 1. Identity

Establish the immutable handle for the sample. Every later statement is tied to this hash.

```bash
file "$TARGET"
wc -c < "$TARGET"
sha256sum "$TARGET" 2>/dev/null || shasum -a 256 "$TARGET"
```

Read the output as: format family (`ELF`/`PE32`/`Mach-O`), architecture, bit width, and
whether the file is dynamically linked. A `PE32+ executable ... GUI` on an ELF host is a
Windows target; say so explicitly rather than forcing it through ELF tooling.

### 2. Layout

Map the section table. Layout anomalies are the cheapest packing signal available.

```bash
readelf -SW "$TARGET" 2>/dev/null || objdump -h "$TARGET"
```

Look for, in priority order:

- **Section count below 8 on a dynamically linked target** — a normal gcc/clang ELF has
  25–35 sections. A count in the single digits means sections were collapsed.
- **`.text` absent or near-zero length** — code is not where it should be.
- **Sections named `.UPX0`, `UPX1`, `.aspack`, `.adata`, `.petite`, `.taz`** — direct
  packer identification, stop here and report it.
- **A section whose file size is zero but whose virtual size is large** — classic unpacker
  stub pattern.
- **W+X section** (flags contain both `W` and `X`) — self-modifying or JIT code.

### 3. Toolchain fingerprint

Different runtimes leave different debris. Check them in this order; the first hit wins.

```bash
strings -a -n 6 "$TARGET" | grep -aiEo \
  'go1\.[0-9]+(\.[0-9]+)?|rustc/-?[0-9.]+|pyinstaller|_MEIPASS|python3\.[0-9]+|mscoree\.dll|\.NETFramework|Zig|GCC: \(.*\)|clang version [0-9.]+' \
  | sort -u | head -20
```

| Evidence string | Toolchain | Confidence |
|---|---|---|
| `go1.xx.x` or section `.gopclntab` | Go | high |
| `rustc/` or `core::panicking` in strings | Rust | high |
| `_MEIPASS` or `pyinstaller` | Python frozen bundle | high |
| `mscoree.dll` in imports, or `#Strings` stream | .NET / CLI | high |
| `GCC: (` or `clang version` | C/C++ (native) | high |
| `_Z` + length-prefixed mangled names only | C++ | medium |
| nothing matched | C, or stripped runtime | low |

For C++ mangling volume, count rather than guess:

```bash
strings -a "$TARGET" | grep -acE '^_Z[A-Za-z0-9_]{6,}$'
```

More than 50 mangled names is a C++ binary. Zero mangled names plus no runtime string means
plain C or heavy stripping.

### 4. Stripping state

Stripping is reported differently by ELF (`.symtab` removed) and PE (COFF symbol table,
always "stripped" in `file` output). Use tool counts, which mean the same thing on both.

```bash
file "$TARGET"
echo "symbol table entries: $(nm "$TARGET" 2>/dev/null | wc -l)"
echo "exports:              $(objdump -T "$TARGET" 2>/dev/null | wc -l)"
```

Read it as:

- **symbol entries > 0** — not stripped. Names are recoverable; step 3 can be re-run with
  `nm` to list them.
- **symbol entries == 0 and `file` says stripped** — stripped. The stripping removes names,
  **not data**: string literals, section contents and code survive untouched. Recover leads
  from `strings` and layout instead.
- **exports non-zero while symbols are zero** — normal. The export table is the import/export
  list, not debug information. Do not report "symbols recovered" on the strength of it.

### 5. Packing and obfuscation

**Locate the entropy before you score it.** A whole-file number averages one dense section
against everything else and hides exactly what you are looking for: a 32 KiB encrypted blob
inside a 115 KiB binary moves the file-level figure to 6.4, well under any packer threshold,
while the section itself sits at 8.0. Score sections, then reason about what each one is.

```bash
node -e '
const fs=require("fs"),cp=require("child_process"),f=process.argv[1],buf=fs.readFileSync(f);
let secs;
try{
  secs=cp.execSync("readelf -SW "+f,{encoding:"utf8",maxBuffer:1<<28,stdio:["pipe","pipe","ignore"]}).split("\n")
    .map(l=>l.match(/\]\s+(\S+)\s+(\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/))
    .filter(Boolean).map(m=>({name:m[1],size:parseInt(m[5],16),off:parseInt(m[4],16)}));
}catch(e){
  secs=cp.execSync("objdump -h "+f,{encoding:"utf8",maxBuffer:1<<28,stdio:["pipe","pipe","ignore"]}).split("\n")
    .map(l=>l.match(/^\s*\d+\s+(\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/))
    .filter(Boolean).map(m=>({name:m[1],size:parseInt(m[2],16),off:parseInt(m[5],16)}));
}
const rows=[];
for(const s of secs){
  if(s.size<256||s.off+s.size>buf.length) continue;
  const d=buf.subarray(s.off,s.off+s.size),c=new Uint32Array(256);
  for(const b of d) c[b]++;
  let H=0; for(const n of c) if(n){const p=n/d.length; H-=p*Math.log2(p);}
  rows.push(H.toFixed(3)+"  "+s.name.padEnd(16)+"  "+String(s.size));
}
console.log(rows.sort().reverse().slice(0,8).join("\n"));' "$TARGET"
```

```bash
grep -aoE 'UPX!|MPRESS|FSG!|PECompact|\.aspack|\.adata|petite|MEW|NsPack' "$TARGET" | sort -u
```

Per-section thresholds:

| Section entropy | Reading |
|---|---|
| < 5.5 | padding, constant tables |
| 5.5 – 7.0 | normal code and data |
| 7.0 – 7.9 | ambiguous: compressed resources, embedded archives |
| ≥ 7.9 | dense: ciphertext or a compressed stream |

The threshold is only half the call. **What the section is** decides the finding:

| Observation | Finding |
|---|---|
| An **executable** section (`CODE`/`X`) at ≥ 7.9 | packed or encrypted code — the strongest signal available |
| A **read-only data** section at ≥ 7.9 while executable sections sit at 5.5–7.0 | an embedded compressed or encrypted resource. Not packing. The code is right there and readable. |
| `.text` raw size ≈ 0 with a large virtual size | unpacker stub; the real code is materialised at runtime |
| A `W`+`X` section (`RWE` segment) | self-modifying or JIT code |
| Packer magic bytes from the grep | report `confirmed` and stop fingerprinting |

A whole-file figure is still worth printing, as context only. Values below 6.5 tell you
nothing either way on a binary under a few megabytes. See `references/entropy.md` for the
full method, the false-positive catalogue, and the confirmations that upgrade `suspected`
to `confirmed`.

### 6. Behavioural leads

These are leads, not conclusions. Each one is a string or an import with a source.

```bash
# Endpoints
strings -a -n 8 "$TARGET" | grep -aoE 'https?://[^ "'"'"'<>)]+' | sort -u | head -20

# Filesystem paths
strings -a -n 5 "$TARGET" | grep -aoE '/(etc|var|tmp|home|usr|opt)/[A-Za-z0-9._/-]{2,}' | sort -u | head -20

# Dangerous imports
objdump -T "$TARGET" 2>/dev/null | grep -aiE '\b(execve|execvp|fork|ptrace|dlopen|dlsym|socket|connect|bind|listen|system|popen|mmap)\b' | awk '{print $NF}' | sort -u

# Credential-shaped literals
strings -a -n 5 "$TARGET" | grep -aiE 'password|passwd|api[_-]?key|secret|token|BEGIN [A-Z ]*PRIVATE KEY' | sort -u | head -10
```

An empty result is a real result. Report `none`, not "unknown".

### 7. Emit the report

Fill the block from `## Output format` exactly. Do not narrate around it. Print it once,
then stop.

## Output format

```
TARGET       <basename>  <sha256 first 16>
FORMAT       <elf|pe|macho|unknown>  <arch>  <bits>  <endian>  <dynamic|static>
SIZE         <bytes>
TOOLCHAIN    <go|rust|cpp|python-frozen|dotnet|c|unknown>  confidence=<high|medium|low>
STRIPPED     <yes|no>  symbols=<n>  exports=<n>
PACKING      <none|suspected:<name>|confirmed:<name>>  max_section=<name>@<x.xxx>  kind=<exec|data|none>
PACKER_HINT  <matched magic bytes, or none>
LAYOUT       sections=<n>  wx_sections=<n>  anomalies=<none|list>
NETWORK      <n>  <first endpoint, truncated>
CREDENTIALS  <n indicators | none>
IMPORTS      <dangerous api names, comma separated, or none>
SIGNALS      <0-3 lines; each: claim — evidence>
NEXT         <decompile-bytecode|dynamic-trace|unpack-first|handoff-managed|abandon>
```

`SIGNALS` carries at most three lines. Each line is `claim — evidence`. A line without
evidence is deleted, not softened.

## Hard constraints

- Report observations and their evidence. Never emit a verdict such as "this is malware",
  "this is safe", "this is cracked", or "this is malicious". Classification is the analyst's call.
- Every claim in the output must cite its evidence: a matched string, a symbol name, a
  section name, a file offset, or an address. Uncited claims must be dropped.
- Do not introduce network access, downloads, or external service calls unless the step
  explicitly declares it and prints what it is about to fetch before fetching it.
- Operate only on the target the user supplied or on this skill's own fixtures.
- Never execute the target. `file`, `readelf`, `objdump`, `strings`, `nm` and `grep` only.
- Never upload the sample, its hash, or its strings to any external service.

## Failure handling

| Symptom | Cause | Fallback |
|---|---|---|
| `readelf: command not found` | binutils not installed | use `objdump -f` for format; report `LAYOUT sections=unavailable` |
| `strings` returns nothing on a >1 MB file | encrypted or packed payload | report `PACKING suspected`, set `NEXT: unpack-first`, stop fingerprinting |
| an **executable** section at ≥ 7.9 | packer or encrypted code | do not report a toolchain; the strings belong to the unpacker stub |
| a **read-only data** section at ≥ 7.9 with `.text` normal | embedded compressed resource, not packing | report the section and its kind, leave `PACKING: none` |
| `objdump -T` empty | static link, or stripped of dynsym | fall back to `nm -D`, then to string heuristics; mark `IMPORTS unknown` |
| target is a .NET assembly | PE with a CLI header | report `TOOLCHAIN dotnet confidence=high`, set `NEXT: handoff-managed`, emit the report and stop |
| target is macOS Mach-O on a Linux host | no `otool` | use `file` plus `strings` only; mark `LAYOUT unavailable` and say which tool is missing |
| file is smaller than 4 KiB | stub, dropper stage, or false positive | say so; a 2 KiB "executable" deserves an explicit note, not a full profile |

## Verification

```bash
cd skills/binary-triage && sh verify.sh
```

Builds the three fixtures, then runs six structural checks. A passing run ends with:

```
verify: 6/6 passed
```

The fixtures and their expected recoverable facts are in `fixtures/README.md`; the
per-fixture expected report shape is in `expected.md`.
