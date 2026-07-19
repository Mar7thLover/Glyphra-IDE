import { useEffect, useRef } from "react";

import { ipc } from "@/lib/ipc/ipc";
import { useUiStore } from "@/lib/stores/uiStore";

import ActivityRail from "./ActivityRail";
import EditorArea from "./EditorArea";
import i18n from "./i18n";
import SideBar from "./SideBar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

function applyBootSettings(theme: string, language: string) {
  if (theme === "light" || theme === "dark") {
    useUiStore.getState().setTheme(theme);
  }
  if (language === "en" || language === "zh-CN") {
    void i18n.changeLanguage(language);
    localStorage.setItem("glyphra.lang", language);
  }
}

export default function App() {
  const setMica = useUiStore((s) => s.setMica);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const settings = await ipc.settingsGet();
        applyBootSettings(settings.theme, settings.language);
      } catch {
        // localStorage FOUC path in index.html already applied a theme
      }
      const env = await ipc.appReady();
      setMica(env.mica);
      requestAnimationFrame(() => void ipc.perfMark("tti"));
    })();
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
