/*
 * Fixture: a normal, unstripped native binary.
 *
 * Ground truth (see fixtures/README.md):
 *   - symbol `planted_marker_fn` is present in .symtab
 *   - literal "REVSKILLS_MARKER_CLEAN_v1" is present in .rodata
 *   - dynamically linked against the platform C library
 *   - .text entropy is in the normal 5.5-6.8 band
 *
 * The two markers exist so a verifier can assert "the triage recovered this" rather than
 * "the triage produced some output".
 */

#include <stdio.h>

const char revskills_marker_clean[] = "REVSKILLS_MARKER_CLEAN_v1";

__attribute__((noinline)) int planted_marker_fn(int x)
{
    int acc = 1;
    for (int i = 1; i <= x; i++) {
        acc = (acc * 31 + i) & 0x7fffffff;
    }
    return acc;
}

int main(int argc, char **argv)
{
    (void)argv;
    printf("%s %d\n", revskills_marker_clean, planted_marker_fn(argc));
    return 0;
}
