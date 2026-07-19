import { Suspense, lazy, useEffect, useRef } from "react";

import OnboardingOverlay from "@/features/onboarding/OnboardingOverlay";
import SettingsPage from "@/features/settings/SettingsPage";
import { ipc } from "@/lib/ipc/ipc";
import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";

import ActivityRail from "./ActivityRail";
import EditorArea from "./EditorArea";
import i18n from "./i18n";
import SideBar from "./SideBar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

const AgentWorkspace = lazy(() => import("@/features/agent/AgentWorkspace"));

function applyBootSettings(theme: string, language: string) {
  if (theme === "light" || theme === "dark") {
    useUiStore.getState().setTheme(theme);
  }
  if (language === "en" || language === "zh-CN") {
    void i18n.changeLanguage(language);
    localStorage.setItem("glyphra.lang", language);
  }
}

function AgentSlot() {
  const open = useUiStore((s) => s.agentOpen);
  return (
    <Suspense
      fallback={
        open ? <aside className="w-[380px] shrink-0 border-l border-line bg-panel" /> : null
      }
    >
      <AgentWorkspace />
    </Suspense>
  );
}

export default function App() {
  const setMica = useUiStore((s) => s.setMica);
  const maybeAutoOpen = useOnboardingStore((s) => s.maybeAutoOpen);
  const hasProject = useProjectStore((s) => !!s.current);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const booted = useRef(false);
  const lastProjectPath = useRef<string | null>(null);

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
      maybeAutoOpen();
    })();
  }, [maybeAutoOpen, setMica]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.settingsOpen) ui.closeSettings();
        ui.toggleAgent();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        useUiStore.getState().toggleSettings();
      }
      if (e.key === "Escape" && useUiStore.getState().settingsOpen) {
        e.preventDefault();
        useUiStore.getState().closeSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (projectPath && projectPath !== lastProjectPath.current) {
      if (usePrefsStore.getState().openAgentOnProject) {
        useUiStore.getState().openAgent();
      }
    }
    lastProjectPath.current = projectPath;
  }, [projectPath]);

  return (
    <div className="relative flex h-full flex-col bg-app text-ink">
      <TitleBar />
      {settingsOpen ? (
        <SettingsPage />
      ) : (
        <div className="flex min-h-0 flex-1">
          {hasProject ? (
            <>
              <ActivityRail />
              <SideBar />
            </>
          ) : null}
          <EditorArea />
          <AgentSlot />
        </div>
      )}
      <StatusBar />
      <OnboardingOverlay />
    </div>
  );
}
