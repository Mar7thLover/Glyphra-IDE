import { describe, expect, it } from "vitest";

import { parseStatusBranchHeader, useGitStore } from "./gitStore";

describe("gitStore.badgeFor", () => {
  it("resolves relative paths under the project root", () => {
    useGitStore.setState({
      statuses: { "src/app/App.tsx": "M", "README.md": "??" },
      branch: null,
    });
    const badgeFor = useGitStore.getState().badgeFor;
    expect(badgeFor("/tmp/proj", "/tmp/proj/src/app/App.tsx")).toBe("M");
    expect(badgeFor("/tmp/proj", "/tmp/proj/README.md")).toBe("??");
    expect(badgeFor("/tmp/proj", "/tmp/proj/missing.ts")).toBeNull();
  });
});

describe("parseStatusBranchHeader", () => {
  it("parses branch, upstream, ahead and behind", () => {
    expect(parseStatusBranchHeader("## main...origin/main [ahead 1, behind 2]")).toEqual({
      name: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
    });
    expect(parseStatusBranchHeader("## feature/foo")).toEqual({
      name: "feature/foo",
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    expect(parseStatusBranchHeader("## main...origin/main [behind 3]")).toEqual({
      name: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 3,
    });
  });
});
