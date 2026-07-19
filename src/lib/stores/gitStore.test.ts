import { describe, expect, it } from "vitest";

import { useGitStore } from "./gitStore";

describe("gitStore.badgeFor", () => {
  it("resolves relative paths under the project root", () => {
    useGitStore.setState({
      statuses: { "src/app/App.tsx": "M", "README.md": "??" },
    });
    const badgeFor = useGitStore.getState().badgeFor;
    expect(badgeFor("/tmp/proj", "/tmp/proj/src/app/App.tsx")).toBe("M");
    expect(badgeFor("/tmp/proj", "/tmp/proj/README.md")).toBe("??");
    expect(badgeFor("/tmp/proj", "/tmp/proj/missing.ts")).toBeNull();
  });
});
