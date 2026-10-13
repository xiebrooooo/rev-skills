# Fixture provenance and scope

This repository ships analysis procedures. Those procedures need something to run against,
which means fixtures, so this page states exactly what a fixture may be.

---

## What a fixture may be

1. **Built from source in this repository.** The preferred case. `fixtures/src/` holds the
   sources, the build script compiles them, and `fixtures/README.md` records the ground
   truth. `skills/binary-triage/` has three of these.

2. **Public open-source software with a published analysis.** Acceptable when the point of
   the skill cannot be demonstrated by a toy program — a real compiler output, a real
   firmware image from an open project, a released binary whose behaviour is already
   documented publicly. The fixture entry must name the upstream project, its licence, and
   the published analysis being reproduced.

That is the whole list.

---

## What a fixture may not be

- **Malware.** Not a live sample, not a defanged sample, not a "safe" repackaged one. A
  procedure can be demonstrated as a technique without shipping the thing it operates on.
- **Commercial software.** No application binaries, no installers, no DRM-protected media.
- **Anything whose purpose is to defeat a licence, activation, DRM, or paywall.** See the
  scoping rule below.
- **Anything you do not have the right to redistribute.** If you are unsure whether you may
  commit it, it is a source file, or it is not a fixture.

---

## The scoping rule

No skill in this repository instructs bypassing a licence check, an activation system, a DRM
scheme, or a paywall, and no fixture is a target of that kind.

**This is a reproducibility rule before it is anything else.** Rule 0 of `SPEC.md` says every
skill must be falsifiable — a stranger runs `verify.sh` and sees whether it works. A skill
aimed at defeating a licence check cannot meet that bar: its fixture cannot be redistributed,
so its `verify.sh` cannot run, so its claim cannot be checked. It would ship as an assertion,
and this repository does not ship assertions.

There is a second, practical consequence. The techniques in the static and dynamic skills —
section entropy, symbol recovery, import triage, unpacking detection — are the same
techniques whether the target is a compiler output, an open-source firmware image, or
anything else. Tying them to a licence-bypass objective narrows the audience and adds
nothing to the method.

---

## What this means when contributing

Before opening a pull request with a fixture, answer these in the fixture's `README.md`:

1. Where did this artifact come from?
2. Under what licence may it be redistributed?
3. What is the ground truth, and how does a reviewer verify it independently?

An unanswered question is a rejected fixture. This is not bureaucracy: `expected.md` is only
meaningful if the artifact it describes has a known, checkable answer.

---

## Scope of the procedures themselves

The skills here analyse artifacts. They do not:

- execute the target (with the explicit exception of skills whose objective *is* dynamic
  observation, where the execution is the declared method and is stated in the skill)
- contact the network unless a step declares the fetch and prints it first
- attribute a sample to an actor, family, or campaign
- emit a verdict. Every skill reports observations with evidence; classification is the
  analyst's call. This is a standing hard constraint in every `SKILL.md`.

---

## Reporting

If a fixture in this repository does not meet the policy above, open an issue naming the
fixture and the rule it breaks. Fixtures are removed rather than argued about.
