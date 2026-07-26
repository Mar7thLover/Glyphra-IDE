import { Check, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import i18n from "@/app/i18n";
import { copyText } from "@/lib/clipboard";
import { buildCrashReport } from "@/lib/crashReport";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

// Top-level crash guard. Without it a render error anywhere below white-screens
// the whole window with no recovery. Must be a class component (React error
// boundaries can't be hooks); kept deliberately dependency-light so it still
// renders when the tree beneath it is broken.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console for now; file-backed crash logging lands with the logging task.
    console.error("[Glyphra] UI crash:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleCopy = async (): Promise<void> => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const report = buildCrashReport(error, componentStack, {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    });
    if (await copyText(report)) {
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  render(): ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    const t = i18n.t.bind(i18n);
    return (
      <div className="fixed inset-0 z-[200] grid place-items-center bg-black/30 p-6 backdrop-blur-[2px]">
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="crash-title"
          className="glass-float pop-in w-full max-w-[520px] rounded-2xl p-5"
        >
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
              <TriangleAlert className="size-4.5" strokeWidth={1.6} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="crash-title" className="text-[13px] font-semibold text-ink">
                {t("error.title", { defaultValue: "Something went wrong" })}
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-ink-3">
                {t("error.body", {
                  defaultValue: "The interface hit an unexpected error. Reloading the window usually recovers it.",
                })}
              </p>
            </div>
          </div>

          {error.message ? (
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-active/60 px-3 py-2 text-[11px] leading-5 whitespace-pre-wrap break-words text-ink-2">
              {error.name}: {error.message}
            </pre>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
            >
              {copied ? (
                <Check className="size-3.5" strokeWidth={1.8} />
              ) : (
                <Copy className="size-3.5" strokeWidth={1.6} />
              )}
              {copied
                ? t("error.copied", { defaultValue: "Copied" })
                : t("error.copy", { defaultValue: "Copy diagnostics" })}
            </button>
            <button
              type="button"
              autoFocus
              onClick={this.handleReload}
              className="btn-accent inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.8} />
              {t("error.reload", { defaultValue: "Reload" })}
            </button>
          </div>
        </section>
      </div>
    );
  }
}
