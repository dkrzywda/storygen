// PostToolUse hook — formats the file Claude Code just edited.
//
// Wired in .claude/settings.json for Edit|Write. Reads the hook payload on
// stdin, pulls tool_input.file_path, and runs Prettier on that one file.
//
// This also normalises CRLF to LF file by file, which is the incremental half
// of the line-ending tripwire documented in CLAUDE.md. It does not fix the
// root cause (missing .gitattributes) — it just stops new edits adding to it.
//
// The matcher fires on every Edit/Write, including files outside this repo
// (auto-memory, scratchpad). Those must not be reformatted with this project's
// Prettier config, so anything resolving outside the project root is skipped.

import { spawnSync } from "node:child_process";
import path from "node:path";

const FORMATTABLE = /\.(ts|tsx|astro|json|jsonc|css|md|mjs)$/i;

const isInsideProject = (filePath, projectDir) => {
  if (!projectDir) return false;
  const rel = path.relative(path.resolve(projectDir), path.resolve(filePath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // malformed payload is not the edit's problem
  }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !FORMATTABLE.test(filePath)) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? payload?.cwd;
  if (!isInsideProject(filePath, projectDir)) process.exit(0);

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
