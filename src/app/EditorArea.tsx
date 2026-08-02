import { lazy, Suspense } from "react";

import WelcomeHome from "@/features/home/WelcomeHome";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

const EditorWorkbench = lazy(() => import("@/features/editor/EditorWorkbench"));
const ReviewPanel = lazy(() => import("@/features/review/ReviewPanel"));
const TerminalPanel = lazy(() => import("@/features/terminal/TerminalPanel"));
const ProblemsPanel = lazy(() => import("@/features/problems/ProblemsPanel"));

export default function EditorArea() {
  const current = useProjectStore((s) => s.current);
  const hasOpenFiles = useEditorStore((s) => s.tabs.length > 0);
  const terminalOpen = useTerminalStore((s) => s.open);
  const problemsOpen = useDiagnosticsStore((s) => s.problemsOpen);
  const workspaceView = useUiStore((s) => s.workspaceView);

  if (current || hasOpenFiles) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-editor">
        <div className="flex min-h-0 flex-1">
          {workspaceView === "git-review" ? (
            <Suspense fallback={<div className="min-w-0 flex-1 bg-editor" />}>
              <ReviewPanel variant="page" />
            </Suspense>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <Suspense fallback={<div className="min-h-0 flex-1 bg-editor" />}>
                  <EditorWorkbench />
                </Suspense>
              </div>
              <Suspense fallback={null}>
                <ReviewPanel />
              </Suspense>
            </>
          )}
        </div>
        {current && problemsOpen ? (
          <Suspense fallback={<div className="h-[220px] border-t border-line bg-panel" />}>
            <ProblemsPanel />
          </Suspense>
        ) : current && terminalOpen ? (
          <Suspense fallback={<div className="h-[220px] border-t border-line bg-panel" />}>
            <TerminalPanel />
          </Suspense>
        ) : null}
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <WelcomeHome />
    </main>
  );
}
