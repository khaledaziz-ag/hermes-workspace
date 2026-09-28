#!/usr/bin/env node
/*
 * patch-swarm-dispatch.js — Patch F: live-dispatch checkpoint timeout must NOT
 * mark a healthy worker BLOCKED (kanban-parity reliability).
 *
 * Defect: in runWorker() (live/tmux delivery), when the sync checkpoint poll
 * window expires before the worker finishes (tasks routinely outlive the
 * 5-300s window), the result is checkpointStatus:'timeout' and
 * dispatchBlockReason() turns that into a BLOCKED mission assignment + blocked
 * runtime, even though the worker is executing normally and checkpoints
 * minutes later. Kanban never does this: a running card stays running.
 *
 * F1: dispatchBlockReason() — a poll timeout is only a block when the worker
 *     process is gone (delivery 'oneshot'). For live delivery the worker is
 *     still running: no block is recorded.
 * F2: live timeout branch — spawn a detached late-reconcile watcher that keeps
 *     polling for the checkpoint (25 min) and then records the REAL outcome
 *     (markCheckpointResult + recordMissionCheckpoint + notification), or a
 *     truthful block if the worker never checkpoints at all.
 *
 * Marker-guarded and idempotent (F1/F2 markers); syntax-verified with
 * node --check; rolls the file back on failure. Re-run on every container
 * start so pull_policy:always image refreshes cannot silently revert it.
 */
const fs = require("fs");
const { execFileSync } = require("child_process");

const MARK_F1 = "/*SWARM_F1_LIVE_TIMEOUT_OK*/";
const NEEDLE_F1 = 'if (result.checkpointStatus === "timeout") return "No fresh checkpoint before poll timeout.";';
const REPL_F1 = 'if (result.checkpointStatus === "timeout") {' + MARK_F1 +
  ' if (result.delivery === "oneshot") return "No fresh checkpoint before poll timeout."; return null; }';

const MARK_F2 = "/*SWARM_F2_LATE_RECONCILE*/";
const NEEDLE_F2 = 'liveResult.checkpoint = null;\n          liveResult.checkpointStatus = "timeout";';
const REPL_F2 = NEEDLE_F2 + '\n          /*SWARM_F2_LATE_RECONCILE*/ setTimeout(() => { (async () => {\n' +
  '            try {\n' +
  '              const _late = await waitForFreshCheckpoint(workerId, previousRaw, baselineRuntimeSignature, startedAt, 1500000);\n' +
  '              if (_late) {\n' +
  '                markCheckpointResult(workerId, _late, options?.notifySessionKey ?? "main");\n' +
  '                recordMissionCheckpoint({ missionId: options?.missionId ?? null, assignmentId: assignment.assignmentId ?? null, workerId, checkpoint: _late, source: "swarm-dispatch-late" });\n' +
  '                appendSwarmMemoryEvent({ workerId, missionId: options?.missionId ?? null, assignmentId: assignment.assignmentId ?? null, type: "checkpoint", summary: _late.result ?? ("Checkpoint " + _late.stateLabel), checkpoint: _late, event: { stateLabel: _late.stateLabel, filesChanged: _late.filesChanged, commandsRun: _late.commandsRun, blocker: _late.blocker, nextAction: _late.nextAction } });\n' +
  '                publishSwarmCheckpointNotification({ workerId, missionId: options?.missionId ?? null, assignmentId: assignment.assignmentId ?? null, checkpoint: _late, notifySessionKey: options?.notifySessionKey ?? "main" });\n' +
  '              } else {\n' +
  '                recordDispatchBlock(workerId, assignment, { workerId, ok: false, output: "", error: "Worker never checkpointed within 25 minutes of dispatch.", durationMs: 0, exitCode: null, delivery: "tmux" }, options);\n' +
  '              }\n' +
  '            } catch (e) {\n' +
  '              try { recordDispatchBlock(workerId, assignment, { workerId, ok: false, output: "", error: "Late-checkpoint reconciler error: " + (e && e.message ? e.message : String(e)), durationMs: 0, exitCode: null, delivery: "tmux" }, options); } catch (e2) {}\n' +
  '            }\n' +
  '          })(); }, 15000);';

function syntaxOk(p) {
  try { execFileSync("node", ["--check", p], { stdio: "pipe" }); return true; }
  catch (e) { return false; }
}

let patched = 0, skipped = 0, failed = 0;
for (const p of process.argv.slice(2)) {
  let s;
  try { s = fs.readFileSync(p, "utf8"); }
  catch (e) { console.log("READ-FAIL " + p); failed++; continue; }
  const orig = s;
  let out = s;

  if (out.indexOf(MARK_F1) === -1) {
    const n1 = out.indexOf(NEEDLE_F1);
    if (n1 < 0) { console.log("F1-MISS " + p); failed++; continue; }
    if (out.indexOf(NEEDLE_F1, n1 + 1) !== -1) { console.log("F1-AMBIG " + p); failed++; continue; }
    out = out.slice(0, n1) + REPL_F1 + out.slice(n1 + NEEDLE_F1.length);
  }
  if (out.indexOf(MARK_F2) === -1) {
    const n2 = out.indexOf(NEEDLE_F2);
    if (n2 < 0) { console.log("F2-MISS " + p); failed++; continue; }
    if (out.indexOf(NEEDLE_F2, n2 + 1) !== -1) { console.log("F2-AMBIG " + p); failed++; continue; }
    out = out.slice(0, n2) + REPL_F2 + out.slice(n2 + NEEDLE_F2.length);
  }

  if (out === orig) { console.log("ALREADY " + p); skipped++; continue; }
  fs.writeFileSync(p, out);
  if (!syntaxOk(p)) { fs.writeFileSync(p, orig); console.log("ROLLBACK " + p); failed++; continue; }
  console.log("PATCHED " + p + " [syntax-verified]");
  patched++;
}
console.log("patched=" + patched + " skipped=" + skipped + " failed=" + failed);
process.exit(failed > 0 ? 1 : 0);
