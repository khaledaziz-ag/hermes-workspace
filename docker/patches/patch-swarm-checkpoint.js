#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const NL = String.fromCharCode(10);

const MARK_A = "/*SWARM_CKPT_LAST_STATE*/";
const NEEDLE_A = "if (!/\\bSTATE\\s*:/i.test(text2)) return null;";
const INJECT_A = ["", "  " + MARK_A,
  "  const _ckptLast = text2.search(/STATE\\s*:(?![\\s\\S]*STATE\\s*:)/i);",
  "  const _ckptScan = _ckptLast > 0 ? text2.slice(_ckptLast) : text2;"].join(NL);
const FROM_A = "const lines = text2.replace(";
const TO_A = "const lines = _ckptScan.replace(";

const MARK_B = "/*SWARM_CKPT_SIG_V3*/";
const NEEDLE_B = "return JSON.stringify(snapshot);";
const REPL_B = "return JSON.stringify({checkpointRaw:snapshot.checkpointRaw,lastResult:snapshot.lastResult,lastSummary:snapshot.lastSummary,blockedReason:snapshot.blockedReason,needsHuman:snapshot.needsHuman}); " + MARK_B;

const MARK_D = "/*SWARM_CKPT_TERMINAL_GATE*/";
const NEEDLE_D = "if (runtimeCheckpoint && runtimeCheckpoint.raw !== previousRaw) return runtimeCheckpoint;";
const REPL_D = 'if (runtimeCheckpoint && runtimeCheckpoint.raw !== previousRaw && runtimeCheckpoint.stateLabel !== "IN_PROGRESS") return runtimeCheckpoint; ' + MARK_D;

function syntaxOk(p){try{execFileSync("node",["--check",p],{stdio:"pipe"});return true;}catch(e){return false;}}

let patched=0,skipped=0,failed=0;
for (const p of process.argv.slice(2)) {
  let s; try{s=fs.readFileSync(p,"utf8");}catch(e){console.log("READ-FAIL "+p);failed++;continue;}
  const orig=s; let out=s;
  if (out.indexOf(MARK_A)===-1) {
    const ni=out.indexOf(NEEDLE_A);
    if(ni<0){console.log("A-MISS "+p);failed++;continue;}
    out=out.slice(0,ni+NEEDLE_A.length)+INJECT_A+out.slice(ni+NEEDLE_A.length);
    const fi=out.indexOf(FROM_A,ni);
    if(fi<0){console.log("FROM-A-MISS "+p);failed++;continue;}
    out=out.slice(0,fi)+TO_A+out.slice(fi+FROM_A.length);
  }
  if (out.indexOf(MARK_B)===-1) {
    const nb=out.indexOf(NEEDLE_B);
    if(nb<0){console.log("B-MISS "+p);failed++;continue;}
    out=out.slice(0,nb)+REPL_B+out.slice(nb+NEEDLE_B.length);
  }
  if (out.indexOf(MARK_D)===-1) {
    const nd=out.indexOf(NEEDLE_D);
    if(nd<0){console.log("D-MISS "+p);failed++;continue;}
    out=out.slice(0,nd)+REPL_D+out.slice(nd+NEEDLE_D.length);
  }
  if(out===orig){console.log("ALREADY "+p);skipped++;continue;}
  fs.writeFileSync(p,out);
  if(!syntaxOk(p)){fs.writeFileSync(p,orig);console.log("ROLLBACK "+p);failed++;continue;}
  console.log("PATCHED "+p+" [syntax-verified]");patched++;
}
console.log("patched="+patched+" skipped="+skipped+" failed="+failed);
process.exit(failed>0?1:0);
