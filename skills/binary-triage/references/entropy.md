# Entropy as a packing signal

Loaded when the whole-file entropy in step 5 lands above 7.2 and the triage needs to decide
whether the target is packed or merely carries compressed assets.

---

## What the number actually measures

Shannon entropy over the byte histogram of a region, in bits per byte. Range is 0–8.

- **0** — every byte identical.
- **8** — every byte value equally likely. This is what ciphertext and compressed data look
  like, and it is also what a good PRNG looks like.

Entropy is a statement about the *histogram*, nothing more. It cannot distinguish
"encrypted" from "already compressed" from "random padding". That is why it is a signal and
not a verdict.

---

## Measure per section, not per file

A whole-file number mixes code, headers, strings and assets. A binary whose `.rodata`
holds one PNG can read 7.4 overall while every executable section is plainly normal. The
useful question is *which region* is dense.

The full script lives in step 5 of `SKILL.md` — it handles ELF (`readelf -SW`) and PE
(`objdump -h`) with one code path. Output for the packed fixture:

```
7.995  .blob             32768
6.252  .text             30448
5.232  .debug_info       4704
4.826  .rdata            2552
```

The top rows are what matter. `.text` at 7.9 is a packer. `.blob` at 7.995 sitting next to a
`.text` at 6.252 is a binary with an embedded dense resource — a completely different
finding, and the distinction the third fixture exists to grade.

**Sections under 256 bytes are skipped in that script.** Below that size the histogram is
too sparse to be meaningful and the number swings wildly between runs.

**A whole-file reading on the packed fixture is 6.399.** Print it if you like, for context,
but never let it gate the localisation step: it crosses no threshold while the section that
matters is 1.6 bits above one.

---

## Thresholds that hold up in practice

| Region entropy | Reading | Typical cause |
|---|---|---|
| < 5.5 | very low | zero padding, constant tables, sparse sections |
| 5.5 – 6.5 | normal code | compiled instructions, branch-heavy |
| 6.5 – 7.2 | normal data | pointer tables, relocations, string pools |
| 7.2 – 7.9 | ambiguous | compressed resources, embedded archives, some JIT output |
| ≥ 7.9 | dense | ciphertext, compressed stream, or a packer's payload |

**Rule of thumb for triage:** a `.text` section at or above 7.9 with a `.text` size that is
implausibly large (a 2 MB `.text` in a 2 MB binary) is a packed target. Report
`PACKING confirmed` and stop fingerprinting — every string you find from here belongs to
the unpacker stub, not to the payload.

---

## Known false positives

Do not report these as packing. Each one is common enough to burn an analyst's afternoon.

| Case | Why entropy is high | How to tell it apart |
|---|---|---|
| Go binaries | embedded type metadata, compressed DWARF in some builds | `.gopclntab` section or `go1.` string present; per-section shows `.rodata` high but `.text` normal |
| Rust binaries with `lto` | heavy inlining plus embedded std library blobs | `rustc` string; `.text` still 6.0–6.8 |
| Frozen Python (`PyInstaller`) | the bytecode archive is zlib-compressed and appended | `_MEIPASS` or `pyinstaller` string; look for a trailing `PYZ` magic |
| .NET single-file | managed assemblies are compressed into the bundle | `#Strings` / `mscoree` present; the CLI header is intact |
| Any binary with an embedded PNG/JPEG/ZIP | those formats are already compressed | per-section entropy localises to one `.rodata` or custom section |
| Statically linked musl | dense libc blob | `musl` string; `.text` < 7.0 |
| Section-level zero-padding | short entropy over a small region | sections under 1 KiB give unstable numbers; ignore them |

---

## Confirmations that upgrade "suspected" to "confirmed"

Entropy alone stays `suspected`. Any of these promotes it:

1. **Packer magic bytes present.** `UPX!`, `MPRESS`, `FSG!`, `PECompact`, `.aspack`,
   `.adata`, `petite`, `MEW`, `NsPack`.
2. **Entry point outside any named section.** `readelf -h` gives `Entry point address`;
   check it falls inside a section marked executable. If not, a stub jumped elsewhere.
3. **Section table collapse.** Fewer than 8 sections on a dynamically linked target, or a
   section with `filesz=0` and a large `memsz`.
4. **The `.text` section's raw size is ~0 while `memsz` is megabytes.** The real code is
   materialised at runtime by an unpacking stub.
5. **A writable and executable segment.** `readelf -lW` shows `RWE` on a `LOAD` segment.
   Normal toolchain output has separate `R E` and `RW ` segments.

Report the specific confirmation you observed, not just the entropy number. "Section `.blob`
entropy 7.98" is evidence. "Looks packed" is not.

---

## When entropy is high but the file is small

Below roughly 4 KiB a single repeated byte value dominates the histogram and entropy
becomes meaningless. A 2 KiB file reading 6.2 tells you nothing. Mark the sample as a stub
or a dropper stage and say the region is too small for entropy to discriminate.
