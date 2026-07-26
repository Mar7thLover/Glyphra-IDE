import { Download, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUpdaterStore } from "@/lib/stores/updaterStore";

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function UpdateBanner() {
  const { t } = useTranslation();
  const status = useUpdaterStore((state) => state.status);
  const version = useUpdaterStore((state) => state.version);
  const downloadedBytes = useUpdaterStore((state) => state.downloadedBytes);
  const totalBytes = useUpdaterStore((state) => state.totalBytes);
  const download = useUpdaterStore((state) => state.download);
  const installAndRestart = useUpdaterStore((state) => state.installAndRestart);
  const dismiss = useUpdaterStore((state) => state.dismiss);

  if (!["available", "downloading", "downloaded", "installing"].includes(status)) {
    return null;
  }

  const progress =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed bottom-8 right-3 z-50 w-[300px] rounded-xl border border-line bg-panel p-3 shadow-[var(--shadow-float)]"
    >
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          {status === "downloaded" || status === "installing" ? (
            <RefreshCw className={`size-4 ${status === "installing" ? "animate-spin" : ""}`} />
          ) : (
            <Download className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium text-ink">
            {t("updater.available", { version })}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-3">
            {status === "downloading"
              ? progress === null
                ? t("updater.downloadedBytes", { value: formatBytes(downloadedBytes) })
                : t("updater.progress", { value: progress })
              : status === "downloaded"
                ? t("updater.ready")
                : status === "installing"
                  ? t("updater.installing")
                  : t("updater.signed")}
          </p>
        </div>
        {status !== "installing" && (
          <button
            type="button"
            aria-label={t("updater.dismiss")}
            onClick={dismiss}
            className="text-ink-3 hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {status === "downloading" && progress !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {status === "available" && (
        <button
          type="button"
          onClick={() => void download()}
          className="mt-2 h-7 w-full rounded-md bg-accent text-[10.5px] font-medium text-white hover:opacity-90"
        >
          {t("updater.download")}
        </button>
      )}
      {status === "downloaded" && (
        <button
          type="button"
          onClick={() => void installAndRestart()}
          className="mt-2 h-7 w-full rounded-md bg-accent text-[10.5px] font-medium text-white hover:opacity-90"
        >
          {t("updater.restartInstall")}
        </button>
      )}
    </aside>
  );
}
