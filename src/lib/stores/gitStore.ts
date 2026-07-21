import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";

export interface GitBranchInfo {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

interface GitState {
  /** relative path → porcelain XY */
  statuses: Record<string, string>;
  branch: GitBranchInfo | null;
  refresh: (projectPath: string) => Promise<void>;
  badgeFor: (projectPath: string, absolutePath: string) => string | null;
}

function toRel(projectPath: string, absolutePath: string): string {
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const full = absolutePath.replace(/\\/g, "/");
  if (full.startsWith(root + "/")) return full.slice(root.length + 1);
  return full;
}

/** Parse `git status -sb` header: `## main...origin/main [ahead 1, behind 2]`. */
export function parseStatusBranchHeader(header: string): GitBranchInfo | null {
  const line = header.trim();
  if (!line.startsWith("## ")) return null;
  const body = line.slice(3).trim();
  if (!body || body.startsWith("HEAD (no branch)") || body.startsWith("No commits")) {
    return { name: "detached", upstream: null, ahead: 0, behind: 0 };
  }

  const tracking = body.match(/^(.+?)(?:\.\.\.(\S+))?(?:\s+\[(.*?)\])?$/);
  if (!tracking) {
    const name = body.split(/\s+/)[0] ?? "HEAD";
    return { name, upstream: null, ahead: 0, behind: 0 };
  }

  const detail = tracking[3] ?? "";
  const aheadMatch = detail.match(/ahead\s+(\d+)/);
  const behindMatch = detail.match(/behind\s+(\d+)/);
  return {
    name: tracking[1],
    upstream: tracking[2] ?? null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

export const useGitStore = create<GitState>((set, get) => ({
  statuses: {},
  branch: null,

  refresh: async (projectPath) => {
    try {
      const [entries, short] = await Promise.all([
        ipc.gitStatus(projectPath),
        ipc.gitExecReadonly(projectPath, ["status", "-sb"]).catch(() => ""),
      ]);
      const statuses: Record<string, string> = {};
      for (const entry of entries) {
        statuses[entry.path.replace(/\\/g, "/")] = entry.status.trim() || entry.status;
      }
      const header = short.split(/\r?\n/).find((line) => line.startsWith("## ")) ?? "";
      set({ statuses, branch: parseStatusBranchHeader(header) });
    } catch {
      set({ statuses: {}, branch: null });
    }
  },

  badgeFor: (projectPath, absolutePath) => {
    const rel = toRel(projectPath, absolutePath);
    return get().statuses[rel] ?? null;
  },
}));
