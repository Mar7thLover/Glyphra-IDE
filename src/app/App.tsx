import { useEffect, useRef } from "react";

import { ipc } from "@/lib/ipc/ipc";
import { useUiStore } from "@/lib/stores/uiStore";

import ActivityRail from "./ActivityRail";
import EditorArea from "./EditorArea";
import SideBar from "./SideBar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

export default function App() {
  const setMica = useUiStore((s) => s.setMica);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void ipc.appReady().then((env) => {
      setMica(env.mica);
      requestAnimationFrame(() => void ipc.perfMark("tti"));
    });
  }, [setMica]);

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityRail />
        <SideBar />
        <EditorArea />
      </div>
      <StatusBar />
    </div>
  );
}
