import { describe, expect, it } from "vitest";

import {
  appendAgentImageFiles,
  attachmentFromImageFile,
  imageAttachmentBytes,
  imageDataUrl,
  MAX_AGENT_IMAGES,
} from "./agentImages";

describe("agent image attachments", () => {
  it("converts supported images to ACP-ready base64", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", {
      type: "image/png",
    });
    const image = await attachmentFromImageFile(file);
    expect(image.data).toBe("AQIDBA==");
    expect(imageAttachmentBytes(image)).toBe(4);
    expect(imageDataUrl(image)).toBe("data:image/png;base64,AQIDBA==");
  });

  it("rejects unsupported image formats", async () => {
    const file = new File(["<svg/>"], "drawing.svg", { type: "image/svg+xml" });
    await expect(attachmentFromImageFile(file)).rejects.toThrow("unsupported image type");
  });

  it("caps the number of images in one prompt", async () => {
    const files = Array.from(
      { length: MAX_AGENT_IMAGES + 1 },
      (_, index) =>
        new File([new Uint8Array([index])], `${index}.png`, { type: "image/png" }),
    );
    const result = await appendAgentImageFiles([], files);
    expect(result.attachments).toHaveLength(MAX_AGENT_IMAGES);
    expect(result.rejected[0]).toContain("Only");
  });
});
