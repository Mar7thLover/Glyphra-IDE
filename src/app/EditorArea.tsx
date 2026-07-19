import { lazy, Suspense } from "react";

import EditorWorkbench from "@/features/editor/EditorWorkbench";
import WelcomeHome from "@/features/home/WelcomeHome";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";

const ReviewPanel = lazy(() => import("@/features/review/ReviewPanel"));
const TerminalPanel = lazy(() => import("@/features/terminal/TerminalPanel"));

export default function EditorArea() {
  const current = useProjectStore((s) => s.current);
  const terminalOpen = useTerminalStore((s) => s.open);

  if (current) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-editor">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <EditorWorkbench />
          </div>
          <Suspense fallback={null}>
            <ReviewPanel />
          </Suspense>
        </div>
        {terminalOpen ? (
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
