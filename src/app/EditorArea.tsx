import EditorWorkbench from "@/features/editor/EditorWorkbench";
import WelcomeHome from "@/features/home/WelcomeHome";
import { useProjectStore } from "@/lib/stores/projectStore";

export default function EditorArea() {
  const current = useProjectStore((s) => s.current);

  if (current) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-editor">
        <EditorWorkbench />
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <WelcomeHome />
    </main>
  );
}
