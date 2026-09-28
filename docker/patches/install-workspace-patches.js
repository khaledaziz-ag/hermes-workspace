#!/usr/bin/env node
/*
 * install-workspace-patches.js — one-shot installer for fresh clones of this repo.
 *
 * Use: `node docker/patches/install-workspace-patches.js`
 * After running, `docker compose up -d` will apply patches automatically each
 * start (the entrypoint already calls patch-*.js; this just ensures the
 * script bundle exists in the right place before that first start).
 *
 * What it does:
 * 1. Copies patch-*.js files from docker/patches/ → /opt/hermes-cli/ on host.
 * 2. Runs patch-disk-cleanup.py once (marks HERMES_HOME/bench protected).
 * 3. Does NOT modify any git-tracked file — safe to re-run.
 */
const fs = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");

const PATCHES_SRC = path.resolve(__dirname); // this dir
const HERMES_CLI = "/opt/hermes-cli";

function cpIfMissing(src, dst) {
    if (fs.existsSync(dst)) {
        console.log("SKIP (exists)", dst);
        return;
    }
    try {
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o644);
        console.log("COPIED", dst);
    } catch (e) {
        console.warn("COPY-FAIL", dst, e.message);
    }
}

// Step 1 — ensure .js patches exist under /opt/hermes-cli
try { fs.mkdirSync(HERMES_CLI, { recursive: true }); } catch (_) {}
for (const f of fs.readdirSync(PATCHES_SRC)) {
    if (!f.endsWith(".js")) continue;
    cpIfMissing(path.join(PATCHES_SRC, f), path.join(HERMES_CLI, f));
}

// Step 2 — run disk-cleanup protection (idempotent, marker-guarded)
const pySrc = path.join(PATCHES_SRC, "patch-disk-cleanup.py");
if (fs.existsSync(pySrc)) {
    cpIfMissing(pySrc, path.join(HERMES_CLI, "patch-disk-cleanup.py"));
    try {
        execFileSync("python3", [path.join(HERMES_CLI, "patch-disk-cleanup.py")],
            { stdio: "pipe" });
        console.log("disk-cleanup patch ran OK");
    } catch (e) {
        console.warn("disk-cleanup patch had warnings (non-fatal):", e.stderr?.toString()?.trim());
    }
}

console.log("install-workspace-patches.js — done.");
