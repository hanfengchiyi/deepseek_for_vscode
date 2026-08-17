/**
 * `/export`: locate a session's raw JSONL event log on disk.
 *
 * The official `dsh-session-log-export` package streams a ZIP through
 * its web host's HTTP endpoint — unusable here. But we mount
 * `dsh-session-persistence-jsonl`, whose on-disk layout is stable:
 *
 *   $DSH_HOME/sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.jsonl[.zstd]
 *
 * `projectKey` / `encodeSegment` below are verbatim copies of the
 * upstream helpers (dsh-session-persistence-jsonl/lib/index.js) — the
 * package does not export them, and diverging would break the lookup.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Verbatim copy of upstream `encodeSegment` (see module docstring). */
function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

/** Verbatim copy of upstream `projectKey` (see module docstring). */
function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

export interface SessionLogLocation {
  /** Absolute path of the raw log artifact. */
  path: string;
  /** Suggested file name for the save dialog. */
  fileName: string;
}

/**
 * Find the raw event log of one session. `cwd` is the session's
 * `meta.cwd` (the workspace root for sessions this extension creates);
 * when unknown, every project directory under the root is tried. Returns
 * undefined when the session has not been persisted yet.
 */
export async function findSessionLog(
  sessionsRoot: string,
  sessionId: string,
  cwd?: string,
): Promise<SessionLogLocation | undefined> {
  const encoded = encodeSegment(sessionId);
  const projectDirs = cwd
    ? [path.join(sessionsRoot, projectKey(cwd))]
    : (await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory())
        .map((e) => path.join(sessionsRoot, e.name));

  for (const project of projectDirs) {
    const dir = path.join(project, encoded);
    for (const suffix of [".jsonl", ".jsonl.zstd"] as const) {
      const file = path.join(dir, `session${suffix}`);
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat?.isFile()) {
        return { path: file, fileName: `${sessionId}${suffix}` };
      }
    }
  }
  return undefined;
}
