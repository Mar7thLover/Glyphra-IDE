import { describe, expect, it } from "vitest";

import { nextDownloadProgress } from "./updaterStore";

describe("nextDownloadProgress", () => {
  it("tracks a known-length download", () => {
    const started = nextDownloadProgress(
      { event: "Started", data: { contentLength: 1_024 } },
      99,
      null,
    );
    expect(started).toEqual({ downloadedBytes: 0, totalBytes: 1_024 });
    expect(
      nextDownloadProgress(
        { event: "Progress", data: { chunkLength: 256 } },
        started.downloadedBytes,
        started.totalBytes,
      ),
    ).toEqual({ downloadedBytes: 256, totalBytes: 1_024 });
  });

  it("supports servers without a content length", () => {
    expect(
      nextDownloadProgress(
        { event: "Started", data: {} },
        0,
        null,
      ),
    ).toEqual({ downloadedBytes: 0, totalBytes: null });
  });
});
