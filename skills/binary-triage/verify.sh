#!/bin/sh
# rev-skills - binary-triage verification
#
# Answers one question: is this skill wired up correctly?
# It does NOT measure whether a model is good at the task - that is bench/.
#
#   cd skills/binary-triage && sh verify.sh
#
# Exit 0 when nothing failed. Skipped checks do not fail the run: they report a toolchain
# that is not present on this machine, which is not a defect in the skill.

set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

TOTAL=6
OK=0
FAILED=0
SKIPPED=0

line() {
    _idx=$1
    _label=$2
    _status=$3
    _detail=${4:-}
    if [ -n "$_detail" ]; then
        printf '[%s/%s] %-40s %s (%s)\n' "$_idx" "$TOTAL" "$_label" "$_status" "$_detail"
    else
        printf '[%s/%s] %-40s %s\n' "$_idx" "$TOTAL" "$_label" "$_status"
    fi
}

pass() { line "$1" "$2" "PASS" "${3:-}"; OK=$((OK + 1)); }
skip() { line "$1" "$2" "SKIP" "${3:-}"; SKIPPED=$((SKIPPED + 1)); }
bad()  { line "$1" "$2" "FAIL" "${3:-}"; FAILED=$((FAILED + 1)); }

# ---------------------------------------------------------------- 1 frontmatter

FM=""
if [ ! -f SKILL.md ]; then
    bad 1 "SKILL.md frontmatter" "SKILL.md not found"
else
    FM=$(awk 'NR==1 && /^---[[:space:]]*$/{f=1;next} f && /^---[[:space:]]*$/{exit} f{print}' SKILL.md)

    problem=""
    for field in name description version tags tools; do
        printf '%s\n' "$FM" | grep -qE "^${field}:[[:space:]]*[^[:space:]]" || problem="$problem missing:${field}"
    done

    desc=$(printf '%s\n' "$FM" | sed -n 's/^description:[[:space:]]*//p' | head -1)
    if ! printf '%s' "$desc" | grep -qiE 'use when|when the user|when you|if the user|when a '; then
        problem="$problem no-trigger-in-description"
    fi
    if [ "${#desc}" -gt 500 ]; then
        problem="$problem description-too-long"
    fi

    if [ -n "$problem" ]; then
        bad 1 "SKILL.md frontmatter" "$problem"
    else
        pass 1 "SKILL.md frontmatter" "name+desc+version+tags+tools"
    fi
fi

# ---------------------------------------------------------------- 2 references

REFS=$(printf '%s\n' "$FM" | sed -n 's/^[[:space:]]*-[[:space:]]*file:[[:space:]]*//p' | tr -d '\r')
ref_count=0
missing_ref=""
for r in $REFS; do
    ref_count=$((ref_count + 1))
    [ -f "$r" ] || missing_ref="$missing_ref $r"
done

if [ -n "$missing_ref" ]; then
    bad 2 "references resolve" "not found:$missing_ref"
else
    pass 2 "references resolve" "$ref_count declared"
fi

# ---------------------------------------------------------------- 3 tools vocabulary

TOOLS=$(printf '%s\n' "$FM" | sed -n 's/^tools:[[:space:]]*\[\(.*\)\].*/\1/p' | tr -d '\r' | tr ',' '\n' | tr -d ' ')
tool_count=0
bad_tool=""
for t in $TOOLS; do
    tool_count=$((tool_count + 1))
    case "$t" in
        bash|read|grep|glob|write|edit|web|browser) ;;
        *) bad_tool="$bad_tool $t" ;;
    esac
done

if [ -n "$bad_tool" ]; then
    bad 3 "tools vocabulary" "outside vocabulary:$bad_tool"
elif [ "$tool_count" -eq 0 ]; then
    bad 3 "tools vocabulary" "no tools declared"
else
    pass 3 "tools vocabulary" "$(echo $TOOLS)"
fi

# ------------------------------------------------- 4 declared requirements
#
# The skill declares its external command dependencies in frontmatter; this checks them.
#
# An earlier revision scraped command positions out of the prose instead. It could not tell
# `grep -E 'execve|fork'` from a pipeline, so it reported two dozen quoted pattern words as
# missing binaries. A check that cries wolf is worse than no check: people learn to skip it.
# A declared list is boring, exact, and forces the author to think about dependencies.

REQS=$(printf '%s\n' "$FM" | sed -n 's/^requires:[[:space:]]*\[\(.*\)\].*/\1/p' | tr -d '\r' | tr ',' '\n' | tr -d ' ')
req_count=0
missing_cmd=""
for c in $REQS; do
    req_count=$((req_count + 1))
    command -v "$c" >/dev/null 2>&1 || missing_cmd="$missing_cmd $c"
done

if [ "$req_count" -eq 0 ]; then
    bad 4 "declared requirements available" "no 'requires:' list in frontmatter"
elif [ -n "$missing_cmd" ]; then
    skip 4 "declared requirements available" "not on PATH:$missing_cmd"
else
    pass 4 "declared requirements available" "$req_count checked, all found"
fi

# ---------------------------------------------------------------- 5 fixtures

missing_bin=""
for b in gcc strip node; do
    command -v "$b" >/dev/null 2>&1 || missing_bin="$missing_bin $b"
done

if [ ! -f fixtures/build.sh ]; then
    bad 5 "fixtures present" "fixtures/build.sh not found"
elif [ -n "$missing_bin" ]; then
    skip 5 "fixtures present" "cannot build without:$missing_bin"
else
    if sh fixtures/build.sh >/dev/null 2>&1; then
        missing_fx=""
        built=0
        for n in triage_clean triage_stripped triage_packed; do
            if [ -f "fixtures/build/$n" ]; then
                built=$((built + 1))
            else
                missing_fx="$missing_fx $n"
            fi
        done
        if [ -n "$missing_fx" ]; then
            bad 5 "fixtures present" "not produced:$missing_fx"
        else
            pass 5 "fixtures present" "$built built"
        fi
    else
        bad 5 "fixtures present" "fixtures/build.sh exited non-zero"
    fi
fi

# ---------------------------------------------------------------- 6 mandatory sections

missing_section=""
last_line=0
for s in "## Objective" "## Execution" "## Output format" "## Hard constraints" "## Failure handling" "## Verification"; do
    ln=$(grep -nxF "$s" SKILL.md 2>/dev/null | head -1 | cut -d: -f1 || true)
    if [ -z "$ln" ]; then
        missing_section="$missing_section [missing:$s]"
    elif [ "$ln" -lt "$last_line" ]; then
        missing_section="$missing_section [out-of-order:$s]"
    else
        last_line=$ln
    fi
done

if [ -n "$missing_section" ]; then
    bad 6 "mandatory sections in order" "$missing_section"
else
    pass 6 "mandatory sections in order" "6/6"
fi

# ---------------------------------------------------------------- summary

echo
if [ "$FAILED" -eq 0 ]; then
    if [ "$SKIPPED" -eq 0 ]; then
        echo "verify: $OK/$TOTAL passed"
    else
        echo "verify: $OK/$TOTAL passed, $SKIPPED skipped"
    fi
    exit 0
fi
echo "verify: $OK/$TOTAL passed, $FAILED failed"
exit 1
