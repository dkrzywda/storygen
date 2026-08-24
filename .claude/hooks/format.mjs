// PostToolUse hook — formats the file Claude Code just edited.
//
// Wired in .claude/settings.json for Edit|Write. Reads the hook payload on
// stdin, pulls tool_input.file_path, and runs Prettier on that one file.
//
// This also normalises CRLF to LF file by file, which is the incremental half
// of the line-ending tripwire documented in CLAUDE.md. It does not fix the
// root cause (missing .gitattributes) — it just stops new edits adding to it.

import { spawnSync } from "node:child_process";

const FORMATTABLE = /\.(ts|tsx|astro|json|jsonc|css|md|mjs)$/i;

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let filePath;
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    process.exit(0); // malformed payload is not the edit's problem
  }

  if (!filePath || !FORMATTABLE.test(filePath)) process.exit(0);

  const result = spawnSync("npx", ["prettier", "--write", filePath], {
    stdio: ["ignore", "ignore", "pipe"],
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    // exit 2 surfaces stderr back to Claude rather than to the user
    process.stderr.write(`prettier failed on ${filePath}\n${result.stderr ?? ""}`);
    process.exit(2);
  }

  process.exit(0);
});
