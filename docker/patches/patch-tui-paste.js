// Idempotent TUI paste-truncation patch (SWARM_FULL_PROMPT_v1).
// pasteTokenLabel in tui_dist/entry.js collapses pasted prompts into
// '[[ head.. [N lines] .. tail ]]' stubs which the worker then receives as
// the actual prompt (proven via state.db). Replace it with identity so the
// full pasted text flows through. Survives container recreates + venv
// reinstalls because this runs from the compose entrypoint each start.
const fs = require("fs");
const { execFileSync } = require("child_process");
const MARK = "SWARM_FULL_PROMPT_v1";
const target = process.argv[2];
if (!target) { console.log("usage: patch-tui-paste.js <entry.js>"); process.exit(0); }
let src;
try { src = fs.readFileSync(target, "utf8"); } catch (e) { console.log("MISS " + target); process.exit(0); }
if (src.includes(MARK)) { console.log("ALREADY " + target); process.exit(0); }
const anchor = "pasteTokenLabel = (text, lineCount) => {";
const start = src.indexOf(anchor);
if (start < 0) { console.log("MISSANCHOR " + target); process.exit(0); }
const tailIdx = src.indexOf("return tail ?", start);
if (tailIdx < 0) { console.log("MISSANCHOR2 " + target); process.exit(0); }
const end = src.indexOf("};", tailIdx) + 2;
if (end <= 1) { console.log("MISSANCHOR3 " + target); process.exit(0); }
const patched = src.slice(0, start) + "pasteTokenLabel = (text, lineCount) => text; /* " + MARK + " */" + src.slice(end);
fs.writeFileSync(target + ".bak.swarmfix", src);
fs.writeFileSync(target, patched);
try {
  execFileSync("node", ["--check", target], { stdio: "pipe" });
  console.log("PATCHED " + target + " [syntax-verified]");
} catch (e) {
  fs.copyFileSync(target + ".bak.swarmfix", target);
  console.log("ROLLBACK " + target + " syntax-fail");
}
