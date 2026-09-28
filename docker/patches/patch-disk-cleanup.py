#!/usr/bin/env python3
"""patch-disk-cleanup.py — permanently protect /bench from auto-cleanup.

The disk-cleanup plugin lives in the container's writable layer (image), so it
resets on every pull_policy:always recreate. This idempotent, marker-guarded
patch is shipped on the bind-mounted /opt/hermes-cli volume and called from
the entrypoint on every start, re-applying the protection each time.

Defect: guess_category() tracks test_* files under HERMES_HOME, so the plugin
auto-deletes benchmark evidence at session end. Fix: add "bench" to the
protected top-level set alongside "auth.json", "hermes-agent".
"""
import sys

P = "/opt/hermes/plugins/disk-cleanup/disk_cleanup.py"
MARK = 'DISKCLEANF_BENCH_PROTECT'
NEEDLE = '"auth.json", "hermes-agent",'
REPL = '"auth.json", "hermes-agent",\n            "bench",  # ' + MARK

try:
    s = open(P).read()
except Exception as e:
    print("READ-FAIL", P, e)
    sys.exit(1)

if MARK in s:
    print("ALREADY", P)
    sys.exit(0)

idx = s.find(NEEDLE)
if idx < 0:
    print("NEEDLE-MISS", P)
    sys.exit(1)
if s.find(NEEDLE, idx + 1) != -1:
    print("AMBIGUOUS", P)
    sys.exit(1)

out = s[:idx] + REPL + s[idx + len(NEEDLE):]
try:
    open(P, "w").write(out)
    import ast
    ast.parse(out)
    print("PATCHED", P, "[syntax-ok]")
except Exception as e:
    open(P, "w").write(s)  # rollback
    print("FAIL ROLLBACK", P, e)
    sys.exit(1)
