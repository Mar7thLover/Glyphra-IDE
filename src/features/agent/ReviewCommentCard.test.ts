import { describe, expect, it } from "vitest";

import {
  parseMessagePatch,
  parseReviewComments,
} from "@/features/agent/ReviewCommentCard";

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

  it("associates fenced unified diffs with review comments", () => {
    const text = [
      "- [warn] `src/a.ts`:2 — stale value",
      "```diff",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2 +2 @@",
      "-const value = 1;",
      "+const value = 2;",
      "```",
    ].join("\n");
    const [comment] = parseReviewComments(text);
    expect(comment.path).toBe("src/a.ts");
    expect(comment.diff).toContain("@@ -2 +2 @@");
    // One file, already adopted by a bullet — nothing left for the patch card.
    expect(parseMessagePatch(text)).toEqual([]);
  });

  it("keeps a lone diff as an inline suggestion", () => {
    const text = [
      "```diff",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "```",
    ].join("\n");
    expect(parseReviewComments(text)).toHaveLength(1);
    expect(parseMessagePatch(text)).toEqual([]);
  });

  it("hands a multi-file patch to the patch card instead of the comment list", () => {
    const text = [
      "```diff",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      "-const b = 1;",
      "+const b = 2;",
      "```",
    ].join("\n");
    expect(parseReviewComments(text)).toEqual([]);
    expect(parseMessagePatch(text).map((file) => file.newPath)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("leaves bullet-attached files to the inline apply and passes the rest on", () => {
    const text = [
      "- [warn] `src/a.ts`:1 — stale value",
      "```diff",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      "-const b = 1;",
      "+const b = 2;",
      "```",
    ].join("\n");
    const comments = parseReviewComments(text);
    expect(comments).toHaveLength(1);
    expect(comments[0].diff).toContain("src/a.ts");
    expect(parseMessagePatch(text).map((file) => file.newPath)).toEqual(["src/b.ts"]);
  });
});
