# Hermes Workspace — Patches & Hardening (khaledaziz-ag fork)

This branch contains runtime patches that close reliability gaps in the upstream
`outsourc-e/hermes-workspace` image (pull_policy:always, no root deploy required).

## Problems fixed

### D1 — False "blocked" on long tasks (Patch F: swarm-dispatch)
**Upstream behavior:** when the sync checkpoint-poll window expired while a worker
was still running, the dispatcher recorded the mission as BLOCKED — even though
the worker later checkpointed successfully. Kanban never does this.
**Fix:** `patch-swarm-dispatch.js`
- F1: poll timeout only blocks `oneshot` delivery; live workers stay unblocked
- F2: late-reconcile watcher polls up to 25 min more and records the real outcome
Marker-guarded, syntax-verified, idempotent. Ran from the compose entrypoint.

### D2 — Upstream parseSwarmCheckpoint() froze missions at 'dispatched'
Worker messages carrying TUI gutter decoration triggered the field anchor
`^\s*` on the first line, so the FIRST checkpoint block won and later valid
checkpoints were ignored.
**Fix:** `patch-swarm-checkpoint.js` — tolerates leading decoration so the LAST
block wins.

### D3 — Artifact deletion: test_* files vanish at session end
The built-in disk-cleanup plugin auto-tracks `test_*` under HERMES_HOME and
deletes them at session boundary, silently destroying benchmark evidence.
**Fix:** `patch-disk-cleanup.py` adds `"bench"` to the protected top-level set
(`DISKCLEANF_BENCH_PROTECT`). Run once on first start (idempotent).

### D4 — Missing tmux + hermes CLI in image
The workspace image ships neither tmux nor the hermes binary, so every worker
spawn failed with ENOENT and showed BLOCKED.
**Fix:** entrypoint now runs `apt-get install -qq tmux` (non-fatal) and generates
per-seat wrappers pointing at `/opt/hermes-cli/venv/bin/hermes`.

### D5 — TUI paste gutter breaks checkpoint parsing
Related to D2: messages with trailing TUI gutter lines were parsed incorrectly.
**Fix:** `patch-tui-paste.js`.

## How to deploy from a fresh clone

```bash
# 1. Clone and enter the repo
git clone https://github.com/khaledaziz-ag/hermes-workspace.git
cd hermes-workspace

# 2. Install the patch scripts into /opt/hermes-cli (required by the entrypoint)
node docker/patches/install-workspace-patches.js

# 3. Start (entrypoint runs all .js patches on every boot automatically)
docker compose up -d

# Verify patches landed
docker compose logs | grep -E "PATCHED|ALREADY"
```

## Persistence guarantees

All fixes are **marker-guarded and idempotent**:
- `.js` patches live in `docker/patches/` in the repo and get copied into
  `/opt/hermes-cli/` (which is bind-mounted rw into the container). The
  entrypoint calls them on every container start — survive `pull_policy:always`.
- `patch-disk-cleanup.py` patches the live plugin file in place (preferencing the
  bind-mounted HERMES_HOME copy). Re-runs are no-ops after the marker is written.
- No commit modifies the upstream Dockerfile or image — purely runtime patches.

## Repo layout

```
docker/patches/
  patch-swarm-checkpoint.js   # marks last-seen checkpoint field wins
  patch-swarm-dispatch.js     # Patch F: no false-block + late reconcile
  patch-tui-paste.js          # TUI gutter tolerance
  patch-disk-cleanup.py       # protect bench/ from auto-delete
  install-workspace-patches.js # copies scripts → /opt/hermes-cli on first run
docker-compose.yml            # modified to call all patches in entrypoint
```

## Upstream

Original: `https://github.com/outsourc-e/hermes-workspace`
This fork is a runtime-hardening overlay — upstream commits merge cleanly via
`git cherry-pick` or `rebase`, since no upstream files were modified directly.
