import { FileWarning, ImageIcon, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { EditorTab } from "@/lib/stores/editorStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaPreview({ tab }: { tab: EditorTab }) {
  const { t } = useTranslation();
  const preview = tab.preview;
  if (!preview) return null;

  const Icon =
    preview.kind === "image"
      ? ImageIcon
      : preview.kind === "audio"
        ? Music2
        : preview.kind === "video"
          ? Video
          : FileWarning;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {preview.kind === "image" && preview.dataUrl ? (
          <img
            src={preview.dataUrl}
            alt={tab.name}
            draggable={false}
            className="max-h-full max-w-full rounded-lg object-contain shadow-[var(--shadow-soft)]"
          />
        ) : preview.kind === "audio" && preview.dataUrl ? (
          <div className="glass-float flex w-full max-w-lg flex-col items-center gap-5 rounded-2xl p-8">
            <Music2 className="size-12 text-accent" strokeWidth={1.2} />
            <div className="text-center">
              <div className="text-sm font-medium text-ink">{tab.name}</div>
              <div className="mt-1 text-xs text-ink-3">
                {preview.mime} · {formatBytes(preview.size)}
              </div>
            </div>
            <audio controls src={preview.dataUrl} className="w-full" />
          </div>
        ) : preview.kind === "video" && preview.dataUrl ? (
          <video
            controls
            src={preview.dataUrl}
            className="max-h-full max-w-full rounded-lg bg-black shadow-[var(--shadow-soft)]"
          />
        ) : (
          <div className="flex max-w-md flex-col items-center text-center">
            <Icon className="size-12 text-ink-3" strokeWidth={1.2} />
            <div className="mt-4 text-sm font-medium text-ink">{tab.name}</div>
            <div className="mt-1 text-xs text-ink-3">
              {preview.mime} · {formatBytes(preview.size)}
            </div>
            <p className="mt-4 text-xs leading-5 text-ink-3">
              {preview.kind === "binary"
                ? t("editor.binaryPreview")
                : t("editor.mediaPreviewTooLarge")}
            </p>
          </div>
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-center font-mono text-[10px] text-ink-3">
        {preview.mime} · {formatBytes(preview.size)}
      </div>
    </div>
  );
}
