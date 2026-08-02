import { Suspense, lazy, useEffect, useRef } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import OnboardingOverlay from "@/features/onboarding/OnboardingOverlay";
import UnsavedChangesDialog from "@/features/editor/UnsavedChangesDialog";
import UpdateBanner from "@/components/UpdateBanner";
import SettingsPage from "@/features/settings/SettingsPage";
import {
  EDITOR_RECOVERY_INTERVAL_MS,
  persistEditorRecovery,
  restoreEditorRecovery,
} from "@/lib/editorRecovery";
import { applyAppearanceSettings } from "@/lib/appearance";
import { ipc, type AppSettings, type LaunchRequest } from "@/lib/ipc/ipc";
import { commandMatches } from "@/lib/keybindings";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useGitStore } from "@/lib/stores/gitStore";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { usePaletteStore } from "@/lib/stores/paletteStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { normalizePath, useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";
import { useUpdaterStore } from "@/lib/stores/updaterStore";
import {
  openFilePath,
  openWorkspacePaths,
  pickFile,
  pickProject,
} from "@/lib/workspaceActions";

import ActivityRail from "./ActivityRail";
import EditorArea from "./EditorArea";
import i18n from "./i18n";
import SideBar from "./SideBar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

const AgentWorkspace = lazy(() => import("@/features/agent/AgentWorkspace"));
const CommandPalette = lazy(() => import("@/features/palette/CommandPalette"));
const mainWindow = getCurrentWindow();
const windowLabel = mainWindow.label;
let launchQueue = Promise.resolve();

function enqueueLaunchRequest(request: LaunchRequest) {
  launchQueue = launchQueue.then(async () => {
    const unsaved = i18n.t("menu.unsavedProject");
    const folders = request.folders ?? (request.projectPath ? [request.projectPath] : []);
    if (folders.length > 0) {
      const opened = await openWorkspacePaths(folders, unsaved);
      if (opened && request.filePath) {
        await useEditorStore.getState().openFile(request.filePath);
      }
      return;
    }
    if (request.filePath) {
      await openFilePath(request.filePath, unsaved);
    }
  });
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
  const hasOpenFiles = useEditorStore((s) => s.tabs.length > 0);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const openEditorPaths = useEditorStore((s) => s.tabs.map((tab) => tab.path).join("\0"));
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
          applyAppearanceSettings(settings);
          usePrefsStore.getState().hydrate(settings);
          useAgentStore
            .getState()
            .hydrateProviderId(usePrefsStore.getState().defaultProviderId);
        } catch {
          // localStorage FOUC path in index.html already applied a theme
        }
        const env = await ipc.appReady();
        setMica(env.mica);
        setHostOs(env.os);
        if (windowLabel === "main") {
          const launchRequest = await ipc.appTakeLaunchRequest();
          if (launchRequest) enqueueLaunchRequest(launchRequest);
          void useUpdaterStore.getState().checkForUpdate(true);
        }
        requestAnimationFrame(() => void ipc.perfMark("tti"));
        maybeAutoOpen();
      });
    return () => {
      disposed = true;
      unlistenLaunch?.();
    };
  }, [maybeAutoOpen, setHostOs, setMica]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AppSettings>("settings-changed", (event) => {
      applyAppearanceSettings(event.payload);
      usePrefsStore.getState().hydrate(event.payload);
      useAgentStore
        .getState()
        .hydrateProviderId(usePrefsStore.getState().defaultProviderId);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("prepare-restart", async () => {
      const currentProject = useProjectStore.getState().current?.path;
      if (currentProject) await persistEditorRecovery(currentProject);
      const agentState = useAgentStore.getState();
      const ids = agentState.liveSessions.map((session) => session.archiveId);
      await Promise.all(ids.map((id) => agentState.closeLiveSession(id)));
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void mainWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current) return;
        const dirty = useEditorStore
          .getState()
          .tabs.some(isEditorTabDirty);
        const currentProject = useProjectStore.getState().current?.path;
        const protectedByRecovery =
          !dirty || (currentProject ? await persistEditorRecovery(currentProject) : false);
        if (dirty && !protectedByRecovery && !window.confirm(i18n.t("menu.unsavedExit"))) return;
        closing.current = true;
        const agentState = useAgentStore.getState();
        const ids = agentState.liveSessions
          .filter((session) => session.projectPath === currentProject)
          .map((session) => session.archiveId);
        await Promise.all(ids.map((id) => agentState.closeLiveSession(id)));
        await mainWindow.destroy();
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
    if (!projectPath) return;
    let disposed = false;
    let interval: number | undefined;
    const flush = () => void persistEditorRecovery(projectPath);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };

    void restoreEditorRecovery(
      projectPath,
      () => !disposed && useProjectStore.getState().current?.path === projectPath,
    ).finally(() => {
      if (disposed) return;
      interval = window.setInterval(flush, EDITOR_RECOVERY_INTERVAL_MS);
      document.addEventListener("visibilitychange", onVisibilityChange);
    });

    return () => {
      disposed = true;
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [projectPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const context = {
        editorFocus: activeElement instanceof Element && Boolean(activeElement.closest(".cm-editor")),
        projectOpen: Boolean(useProjectStore.getState().current),
        settingsOpen: useUiStore.getState().settingsOpen,
        agentBusy: useAgentStore.getState().busy,
      };
      if (commandMatches(e, "workbench.openFolder", context)) {
        e.preventDefault();
        void pickProject(i18n.t("empty.openFolder"), i18n.t("menu.unsavedProject"));
        return;
      }
      if (commandMatches(e, "workbench.openFile", context)) {
        e.preventDefault();
        void pickFile(i18n.t("menu.openFile"), i18n.t("menu.unsavedProject"));
        return;
      }
      if (commandMatches(e, "workbench.toggleAgent", context)) {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.settingsOpen) ui.closeSettings();
        ui.toggleAgent();
        return;
      }
      if (commandMatches(e, "workbench.settings", context)) {
        e.preventDefault();
        useUiStore.getState().toggleSettings();
        return;
      }
      if (commandMatches(e, "workbench.toggleTerminal", context)) {
        e.preventDefault();
        useDiagnosticsStore.getState().setProblemsOpen(false);
        useTerminalStore.getState().toggle();
        return;
      }
      if (commandMatches(e, "workbench.search", context)) {
        e.preventDefault();
        useUiStore.getState().togglePanel("search");
        return;
      }
      if (commandMatches(e, "workbench.review", context)) {
        e.preventDefault();
        useReviewStore.getState().openReview(useProjectStore.getState().current?.path);
        return;
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

  useEffect(() => {
    const rootPaths = useProjectStore.getState().roots.map((root) => root.path);
    const looseFiles = openEditorPaths
      .split("\0")
      .filter(Boolean)
      .filter((path) => !rootPaths.some((root) => {
        const normalized = normalizePath(path);
        const normalizedRoot = normalizePath(root);
        return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
      }));
    if (looseFiles.length === 0) return;

    let disposed = false;
    const watcherIds: number[] = [];
    const refreshTimers = new Map<string, number>();
    for (const path of looseFiles) {
      void ipc
        .fsWatchStart(path, (event) => {
          if (disposed) return;
          for (const changedPath of event.paths) {
            const previous = refreshTimers.get(changedPath);
            if (previous !== undefined) window.clearTimeout(previous);
            refreshTimers.set(
              changedPath,
              window.setTimeout(() => {
                refreshTimers.delete(changedPath);
                void useEditorStore.getState().syncFromDisk([changedPath]);
              }, 120),
            );
          }
        })
        .then((watcherId) => {
          if (disposed) void ipc.fsWatchStop(watcherId);
          else watcherIds.push(watcherId);
        })
        .catch(() => {
          // A file may disappear between opening it and starting the watcher.
          // The editor will surface the next explicit read/save error.
        });
    }

    return () => {
      disposed = true;
      for (const timer of refreshTimers.values()) window.clearTimeout(timer);
      refreshTimers.clear();
      for (const watcherId of watcherIds) void ipc.fsWatchStop(watcherId);
    };
  }, [openEditorPaths, projectPath]);

  return (
    <div className="relative flex h-full flex-col bg-app text-ink">
      <TitleBar />
      {settingsOpen ? (
        <SettingsPage />
      ) : (
        <div className="flex min-h-0 flex-1">
          {hasProject || hasOpenFiles ? (
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
      <UpdateBanner />
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  );
}
