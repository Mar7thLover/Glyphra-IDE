import { Suspense, lazy, useEffect, useRef } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import OnboardingOverlay from "@/features/onboarding/OnboardingOverlay";
import UnsavedChangesDialog from "@/features/editor/UnsavedChangesDialog";
import SettingsPage from "@/features/settings/SettingsPage";
import { ipc, type LaunchRequest } from "@/lib/ipc/ipc";
import { useGitStore } from "@/lib/stores/gitStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { usePaletteStore } from "@/lib/stores/paletteStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";
import { openProjectPath, pickFile, pickProject } from "@/lib/workspaceActions";

import ActivityRail from "./ActivityRail";
import EditorArea from "./EditorArea";
import i18n from "./i18n";
import SideBar from "./SideBar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

const AgentWorkspace = lazy(() => import("@/features/agent/AgentWorkspace"));
const CommandPalette = lazy(() => import("@/features/palette/CommandPalette"));
const mainWindow = getCurrentWindow();
let launchQueue = Promise.resolve();

function enqueueLaunchRequest(request: LaunchRequest) {
  launchQueue = launchQueue.then(async () => {
    const opened = await openProjectPath(request.projectPath, i18n.t("menu.unsavedProject"));
    if (opened && request.filePath) {
      await useEditorStore.getState().openFile(request.filePath);
    }
  });
}

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
  const setHostOs = useUiStore((s) => s.setHostOs);
  const maybeAutoOpen = useOnboardingStore((s) => s.maybeAutoOpen);
  const hasProject = useProjectStore((s) => !!s.current);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const booted = useRef(false);
  const closing = useRef(false);
  const lastProjectPath = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlistenLaunch: (() => void) | undefined;
    void listen<LaunchRequest>("launch-request", (event) => enqueueLaunchRequest(event.payload))
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenLaunch = unlisten;
        if (booted.current) return;
        booted.current = true;
        try {
          const settings = await ipc.settingsGet();
          applyBootSettings(settings.theme, settings.language);
        } catch {
          // localStorage FOUC path in index.html already applied a theme
        }
        const env = await ipc.appReady();
        setMica(env.mica);
        setHostOs(env.os);
        const launchRequest = await ipc.appTakeLaunchRequest();
        if (launchRequest) enqueueLaunchRequest(launchRequest);
        requestAnimationFrame(() => void ipc.perfMark("tti"));
        maybeAutoOpen();
      });
    return () => {
      disposed = true;
      unlistenLaunch?.();
    };
  }, [maybeAutoOpen, setHostOs, setMica]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void mainWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current) return;
        const dirty = useEditorStore
          .getState()
          .tabs.some((tab) => tab.content !== tab.savedContent);
        if (dirty && !window.confirm(i18n.t("menu.unsavedExit"))) return;
        closing.current = true;
        await ipc.appExit();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (e.shiftKey) {
          void pickFile(i18n.t("menu.openFile"), i18n.t("menu.unsavedProject"));
        } else {
          void pickProject(i18n.t("empty.openFolder"), i18n.t("menu.unsavedProject"));
        }
      }
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
      if ((e.metaKey || e.ctrlKey) && e.key === "`") {
        e.preventDefault();
        useTerminalStore.getState().toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        useUiStore.getState().togglePanel("search");
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        useReviewStore.getState().openReview(useProjectStore.getState().current?.path);
      }
      if (e.key === "Escape") {
        if (usePaletteStore.getState().open) {
          e.preventDefault();
          usePaletteStore.getState().setOpen(false);
          return;
        }
        if (useUiStore.getState().settingsOpen) {
          e.preventDefault();
          useUiStore.getState().closeSettings();
        }
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
      void useGitStore.getState().refresh(projectPath);
      void useReviewStore.getState().refresh(projectPath);
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
      <UnsavedChangesDialog />
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  );
}
