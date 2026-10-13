#!/bin/sh
# Build the binary-triage fixtures. POSIX sh, runnable from anywhere.
#
# Artifacts land in fixtures/build/ and are normalised to extension-less names so that
# verify.sh and any consumer can refer to one path on every platform. Analysis tools work
# by content, not by extension, so renaming a PE from .exe costs nothing.

set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$HERE/build"
CC=${CC:-gcc}
STRIP=${STRIP:-strip}

case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) EXT=".exe" ;;
    *)                    EXT="" ;;
esac

command -v "$CC" >/dev/null 2>&1   || { echo "build.sh: compiler '$CC' not found" >&2; exit 1; }
command -v node >/dev/null 2>&1    || { echo "build.sh: node not found" >&2; exit 1; }

mkdir -p "$OUT"

echo "build.sh: triage_clean"
"$CC" -O1 -g0 -o "$OUT/triage_clean$EXT" "$HERE/src/triage_clean.c"

echo "build.sh: triage_stripped"
cp -f "$OUT/triage_clean$EXT" "$OUT/triage_stripped$EXT"
if command -v "$STRIP" >/dev/null 2>&1; then
    "$STRIP" "$OUT/triage_stripped$EXT"
else
    echo "build.sh: '$STRIP' not found - triage_stripped will not actually be stripped" >&2
fi

echo "build.sh: triage_packed"
node "$HERE/src/gen_packed.mjs" "$OUT/triage_packed.c"
"$CC" -O1 -g0 -o "$OUT/triage_packed$EXT" "$OUT/triage_packed.c"

for name in triage_clean triage_stripped triage_packed; do
    if [ -n "$EXT" ] && [ -f "$OUT/$name$EXT" ]; then
        mv -f "$OUT/$name$EXT" "$OUT/$name"
    fi
done

echo "build.sh: fixtures ready"
for name in triage_clean triage_stripped triage_packed; do
    if [ -f "$OUT/$name" ]; then
        printf '  %-20s %s bytes\n' "$name" "$(wc -c < "$OUT/$name" | tr -d ' ')"
    else
        printf '  %-20s MISSING\n' "$name"
        exit 1
    fi
done
