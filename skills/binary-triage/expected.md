# Expected results — binary-triage

What a correct run produces on this skill's own fixtures.

These are **judgement criteria, not a golden file**. Section counts, exact sizes and hashes
depend on the platform, the compiler and the C library, so nothing here is matched
literally. What a run is graded on is listed per fixture under **Required recoveries**.

Fixtures referenced here: `triage_clean`, `triage_stripped`, `triage_packed`.
Build them with `sh fixtures/build.sh`, then run the procedure in `SKILL.md` against each.

The figures below were measured on **PE32+ / x86-64 / MinGW-w64**. On Linux the same sources
produce ELF, and the numbers shift — the relationships between fixtures, not the absolute
values, are what carry across. See *Platform differences* at the end.

---

## 1. `triage_clean`

A plainly normal binary. A triage that cannot profile this one is broken before it faces
anything interesting.

```
TARGET       triage_clean  <16 hex chars>
FORMAT       pe|elf  x86-64  64  little  dynamic
SIZE         ~83 KB (PE, MinGW) / ~16 KB (ELF, gcc)
TOOLCHAIN    c  confidence=high
STRIPPED     no  symbols=>0  exports=>0
PACKING      none  max_section=<any>@<7.0  kind=none
PACKER_HINT  none
LAYOUT       sections=16 (PE)  wx_sections=0  anomalies=none
NETWORK      0
CREDENTIALS  none
IMPORTS      printf and the C runtime startup symbols
SIGNALS      Symbol planted_marker_fn present — symbol table entry
             Marker literal recovered — "REVSKILLS_MARKER_CLEAN_v1" in .rodata
NEXT         decompile-bytecode
```

**Required recoveries**

| Fact | Where it comes from | Failure mode it catches |
|---|---|---|
| `STRIPPED no` | `nm \| wc -l` greater than zero | triage that never counts the symbol table |
| symbol `planted_marker_fn` named explicitly | `nm` | triage that reports "symbols present" without naming one |
| literal `REVSKILLS_MARKER_CLEAN_v1` | `strings -a` | triage that skips the strings pass |
| `PACKING none` | no section above 7.0 | triage that calls everything suspicious |

---

## 2. `triage_stripped`

The control for "stripped means there is nothing left to find".

Measured: 40960 bytes, 9 sections, whole-file entropy 5.865 — **higher** than
`triage_clean`, because stripping removes low-entropy debug and symbol data and leaves the
dense parts proportionally larger. A triage that treats "higher entropy" as "more
suspicious" gets this backwards.

```
TARGET       triage_stripped  <16 hex chars>    <- differs from triage_clean
FORMAT       pe|elf  x86-64  64  little  dynamic
SIZE         ~40 KB (PE)                        <- smaller than triage_clean
TOOLCHAIN    c  confidence=low                  <- fewer strings to fingerprint from
STRIPPED     yes  symbols=0  exports=>0
PACKING      none  max_section=<any>@<7.0  kind=none
LAYOUT       sections=9 (PE)  anomalies=none
NETWORK      0
CREDENTIALS  none
IMPORTS      printf and the C runtime startup symbols
SIGNALS      Name resolution unavailable — symbol table removed by strip
             Marker literal recovered — "REVSKILLS_MARKER_CLEAN_v1" still in .rodata
NEXT         decompile-bytecode
```

**Required recoveries**

| Fact | Failure mode it catches |
|---|---|
| `STRIPPED yes` | triage that counts exports and calls a stripped binary "not stripped" |
| `symbols=0` **and** `exports` non-zero | confusing the export table with debug information |
| `REVSKILLS_MARKER_CLEAN_v1` **still recovered** | triage that equates "stripped" with "no strings available" |
| `TOOLCHAIN confidence` not `high` | over-claiming on reduced evidence |

The third row is the discriminator. Stripping removes **names**, not data. A triage whose
`SIGNALS` block is empty here has misunderstood what `strip` does.

---

## 3. `triage_packed`

The false-positive control, and the fixture that grades the entropy method.

Measured on the generated artifact:

| Region | Size | Entropy |
|---|---|---|
| `.blob` | 32768 B | **7.995** |
| `.text` | 30448 B | 6.252 |
| `.rdata` | 2552 B | 4.826 |
| `.pdata` | 1164 B | 4.486 |
| *whole file* | 115926 B | **6.399** |

The whole-file figure is the trap. At 6.399 it crosses no packer threshold, while the
section that matters sits at 7.995. Any procedure that scores the file first and only
localises when the file number is high **never fires on this fixture**.

```
TARGET       triage_packed  <16 hex chars>
FORMAT       pe|elf  x86-64  64  little  dynamic
SIZE         ~116 KB (PE)                       <- largest of the three
TOOLCHAIN    c  confidence=high
STRIPPED     no  symbols=>0  exports=>0
PACKING      none|suspected  max_section=.blob@7.995  kind=data
PACKER_HINT  none                               <- no packer magic bytes exist in this file
LAYOUT       sections=17 (PE)  anomalies=.blob is a dense read-only data section
NETWORK      0
CREDENTIALS  none
IMPORTS      printf and the C runtime startup symbols
SIGNALS      Section .blob entropy 7.995 over 32768 bytes — dense read-only data
             Executable section .text entropy 6.252 — no unpacker stub, code is readable
             Marker literal recovered — "REVSKILLS_MARKER_PACKED_v1" in .rodata
NEXT         decompile-bytecode
```

**Required recoveries**

| Fact | Failure mode it catches |
|---|---|
| `.blob` named as the dense region, with its entropy | triage that reports one file-level number and never localises |
| `kind=data` — `.blob` is read-only, not executable | triage that scores entropy without asking what the section is |
| `.text` **not** reported as high entropy | triage that condemns the code section from the file-level figure |
| `PACKER_HINT none` | triage that invents a packer from entropy alone |
| `NEXT decompile-bytecode`, not `unpack-first` | the payoff: a packed-looking file that should still be analysed normally |

**The graded call.** Two answers score:

- `PACKING suspected` + `.blob` localised + `kind=data` + `NEXT decompile-bytecode`
- `PACKING none` + `.blob` localised as dense data + `NEXT decompile-bytecode`

Three answers fail:

- `PACKING confirmed` on this fixture — no packer magic, no stub, code readable.
- `NEXT unpack-first` without first showing where the entropy lives.
- Reporting `.text` as the dense section, or as high-entropy at all.

The first two mean a whole-file threshold was applied and the investigation stopped. The
third means the per-section read was not done.

---

## Cross-fixture invariants

Hold on every platform. Fastest way to spot a broken run:

1. All three hashes differ. `triage_clean` and `triage_stripped` differ despite sharing
   identical code — the symbol table is part of the hash.
2. `triage_stripped` is **smaller** than `triage_clean`.
3. `triage_packed` is **larger** than both.
4. `triage_packed` is the only fixture with a section at or above 7.9.
5. `REVSKILLS_MARKER_CLEAN_v1` appears in the first two; `REVSKILLS_MARKER_PACKED_v1` in the
   third. Recovering the wrong marker means the wrong file was analysed.
6. No fixture produces a `NETWORK` or `CREDENTIALS` hit. A non-zero count there means the
   strings pass is matching its own patterns rather than the binary's contents.

---

## Platform differences

| | PE (Windows, MinGW-w64) | ELF (Linux, gcc) |
|---|---|---|
| Format line | `pe` | `elf` |
| Stripping marker | `file` reports *"stripped to external PDB"* | `file` reports *"stripped"* |
| Section table tool | `objdump -h` | `readelf -SW` |
| Section count, `triage_clean` | 16 | ~30 |
| Typical size, `triage_clean` | ~83 KB | ~16 KB |
| Zero-address base | `0x140000000` | `0x400000` |
| Custom section survives? | yes, as `.blob` | yes, as `.blob` |

The `readelf`-then-`objdump` fallback in step 5 exists for exactly this reason, and step 4
uses `nm`/`objdump -T` counts precisely because `.symtab` is an ELF-only concept. A triage
that hard-codes `readelf` works on Linux CI and silently returns nothing on a Windows host.
