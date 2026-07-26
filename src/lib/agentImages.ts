import type { AgentImageAttachment } from "@/lib/acp/types";

export const MAX_AGENT_IMAGES = 4;
export const MAX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AGENT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface AppendAgentImagesResult {
  attachments: AgentImageAttachment[];
  rejected: string[];
}

export function imageAttachmentBytes(image: AgentImageAttachment): number {
  const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((image.data.length * 3) / 4) - padding);
}

export function imageDataUrl(image: AgentImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function attachmentFromImageFile(file: File): Promise<AgentImageAttachment> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`${file.name}: unsupported image type ${file.type || "unknown"}`);
  }
  if (file.size <= 0) throw new Error(`${file.name}: empty image`);
  if (file.size > MAX_AGENT_IMAGE_BYTES) {
    throw new Error(`${file.name}: image exceeds 8 MiB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random()}`,
    name: file.name || "pasted-image",
    mimeType: file.type,
    data: bytesToBase64(bytes),
  };
}

export async function appendAgentImageFiles(
  current: AgentImageAttachment[],
  files: Iterable<File>,
): Promise<AppendAgentImagesResult> {
  const attachments = [...current];
  const rejected: string[] = [];
  let total = attachments.reduce((sum, image) => sum + imageAttachmentBytes(image), 0);

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (attachments.length >= MAX_AGENT_IMAGES) {
      rejected.push(`Only ${MAX_AGENT_IMAGES} images can be attached`);
      break;
    }
    try {
      const attachment = await attachmentFromImageFile(file);
      const size = imageAttachmentBytes(attachment);
      if (total + size > MAX_AGENT_IMAGE_TOTAL_BYTES) {
        rejected.push(`${file.name}: total image size exceeds 20 MiB`);
        continue;
      }
      attachments.push(attachment);
      total += size;
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { attachments, rejected };
}
