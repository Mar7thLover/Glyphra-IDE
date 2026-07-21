import { describe, expect, it } from "vitest";

import { parseReviewComments } from "@/features/agent/ReviewCommentCard";

describe("parseReviewComments", () => {
  it("parses severity-tagged review bullets and ignores prose", () => {
    const text = [
      "Here are the findings:",
      "- [error] `src/a.ts`:12 — null deref risk",
      "- [warn] lib/b.rs:40-42: missing timeout",
      "- [info] README.md:1 — clarify install steps",
      "Thanks!",
    ].join("\n");

    expect(parseReviewComments(text)).toEqual([
      {
        severity: "error",
        path: "src/a.ts",
        line: 12,
        endLine: undefined,
        message: "null deref risk",
      },
      {
        severity: "warn",
        path: "lib/b.rs",
        line: 40,
        endLine: 42,
        message: "missing timeout",
      },
      {
        severity: "info",
        path: "README.md",
        line: 1,
        endLine: undefined,
        message: "clarify install steps",
      },
    ]);
  });
});
