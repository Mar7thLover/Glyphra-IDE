import { create } from "zustand";

import i18n from "@/app/i18n";
import type {
  AgentApprovalReviewer,
  AgentPermissionMode,
  StartableBackend,
} from "@/lib/acp/types";
import {
  ipc,
  type AppSettings,
  type ImportedTheme,
  type KeybindingSetting,
} from "@/lib/ipc/ipc";
import { useUiStore } from "@/lib/stores/uiStore";
import { applyImportedTheme } from "@/lib/vscodeTheme";

const LEGACY_PREFS_KEY = "glyphra.prefs";

export const DEFAULT_KEYBINDINGS: KeybindingSetting[] = [
  { command: "workbench.commands", key: "Ctrl+K", when: null },
  { command: "workbench.quickOpen", key: "Ctrl+P", when: "projectOpen" },
  { command: "workbench.openFolder", key: "Ctrl+O", when: null },
  { command: "workbench.openFile", key: "Ctrl+Shift+P", when: null },
  {
    command: "editor.goToSymbol",
    key: "Ctrl+Shift+O",
    when: "editorFocus && projectOpen",
  },
  { command: "workbench.toggleAgent", key: "Ctrl+J", when: null },
  { command: "workbench.settings", key: "Ctrl+,", when: null },
  { command: "workbench.toggleTerminal", key: "Ctrl+`", when: "projectOpen" },
  { command: "workbench.search", key: "Ctrl+Shift+F", when: "projectOpen" },
  { command: "workbench.review", key: "Ctrl+Shift+R", when: "projectOpen" },
  { command: "editor.inlineEdit", key: "Ctrl+K", when: "editorFocus" },
  { command: "editor.goToDefinition", key: "F12", when: "editorFocus" },
  { command: "editor.findReferences", key: "Shift+F12", when: "editorFocus" },
  { command: "editor.rename", key: "F2", when: "editorFocus" },
  { command: "editor.save", key: "Ctrl+S", when: "editorFocus" },
  { command: "editor.close", key: "Ctrl+W", when: "editorFocus" },
  { command: "editor.nextTab", key: "Ctrl+Tab", when: "editorFocus" },
];

export interface GlyphraPrefs {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  formatOnSave: boolean;
  minimap: boolean;
  breadcrumbs: boolean;
  stickyScroll: boolean;
  bracketPairColorization: boolean;
  indentGuides: boolean;
  ghostText: boolean;
  ghostTextDelayMs: number;
  languageServer: boolean;
  languageServerDisabled: string[];
  customTheme: ImportedTheme | null;
  terminalWebgl: boolean;
  defaultMode: AgentPermissionMode;
  defaultBackend: StartableBackend;
  defaultProviderId: string | null;
  defaultAgentModel: string | null;
  defaultReasoningEffort: string | null;
  defaultContextWindow: number | null;
  defaultFastMode: boolean;
  defaultApprovalReviewer: AgentApprovalReviewer;
  openAgentOnProject: boolean;
  showSelectionAgentButton: boolean;
  keybindings: KeybindingSetting[];
}

export const defaultPrefs: GlyphraPrefs = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  formatOnSave: false,
  minimap: false,
  breadcrumbs: true,
  stickyScroll: true,
  bracketPairColorization: true,
  indentGuides: true,
  ghostText: false,
  ghostTextDelayMs: 400,
  languageServer: true,
  languageServerDisabled: [],
  customTheme: null,
  terminalWebgl: false,
  defaultMode: "standard",
  defaultBackend: "auto",
  defaultProviderId: null,
  defaultAgentModel: null,
  defaultReasoningEffort: null,
  defaultContextWindow: null,
  defaultFastMode: false,
  defaultApprovalReviewer: "user",
  openAgentOnProject: false,
  showSelectionAgentButton: false,
  keybindings: DEFAULT_KEYBINDINGS,
};

function readLegacyPrefs(): Partial<GlyphraPrefs> | null {
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<GlyphraPrefs>) : null;
  } catch {
    return null;
  }
}

let legacyPrefs = readLegacyPrefs();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function prefsFromSettings(settings: AppSettings): GlyphraPrefs {
  return {
    fontSize: settings.fontSize,
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap,
    lineNumbers: settings.lineNumbers,
    trimTrailingWhitespace: settings.trimTrailingWhitespace,
    insertFinalNewline: settings.insertFinalNewline,
    formatOnSave: settings.formatOnSave,
    minimap: settings.minimap,
    breadcrumbs: settings.breadcrumbs,
    stickyScroll: settings.stickyScroll,
    bracketPairColorization: settings.bracketPairColorization,
    indentGuides: settings.indentGuides,
    ghostText: settings.ghostText,
    ghostTextDelayMs: settings.ghostTextDelayMs,
    languageServer: settings.languageServer,
    languageServerDisabled: [...settings.languageServerDisabled],
    customTheme: settings.customTheme,
    terminalWebgl: settings.terminalWebgl,
    defaultMode: settings.defaultMode as AgentPermissionMode,
    defaultBackend: settings.defaultBackend as StartableBackend,
    defaultProviderId: settings.defaultProviderId,
    defaultAgentModel: settings.defaultAgentModel,
    defaultReasoningEffort: settings.defaultReasoningEffort,
    defaultContextWindow: settings.defaultContextWindow,
    defaultFastMode: settings.defaultFastMode,
    defaultApprovalReviewer: settings.defaultApprovalReviewer as AgentApprovalReviewer,
    openAgentOnProject: settings.openAgentOnProject,
    showSelectionAgentButton: settings.showSelectionAgentButton,
    keybindings:
      settings.keybindings.length > 0
        ? settings.keybindings.map((binding) => ({ ...binding }))
        : DEFAULT_KEYBINDINGS.map((binding) => ({ ...binding })),
  };
}

function appSettings(
  prefs: GlyphraPrefs,
  theme: string = useUiStore.getState().theme,
  language: string = i18n.language.startsWith("zh") ? "zh-CN" : "en",
  themeVariant: string = useUiStore.getState().variant,
): AppSettings {
  return {
    theme,
    themeVariant,
    language,
    fontSize: prefs.fontSize,
    tabSize: prefs.tabSize,
    wordWrap: prefs.wordWrap,
    lineNumbers: prefs.lineNumbers,
    trimTrailingWhitespace: prefs.trimTrailingWhitespace,
    insertFinalNewline: prefs.insertFinalNewline,
    formatOnSave: prefs.formatOnSave,
    minimap: prefs.minimap,
    breadcrumbs: prefs.breadcrumbs,
    stickyScroll: prefs.stickyScroll,
    bracketPairColorization: prefs.bracketPairColorization,
    indentGuides: prefs.indentGuides,
    ghostText: prefs.ghostText,
    ghostTextDelayMs: prefs.ghostTextDelayMs,
    languageServer: prefs.languageServer,
    languageServerDisabled: prefs.languageServerDisabled,
    customTheme: prefs.customTheme,
    terminalWebgl: prefs.terminalWebgl,
    defaultMode: prefs.defaultMode,
    defaultBackend: prefs.defaultBackend,
    defaultProviderId: prefs.defaultProviderId,
    defaultAgentModel: prefs.defaultAgentModel,
    defaultReasoningEffort: prefs.defaultReasoningEffort,
    defaultContextWindow: prefs.defaultContextWindow,
    defaultFastMode: prefs.defaultFastMode,
    defaultApprovalReviewer: prefs.defaultApprovalReviewer,
    openAgentOnProject: prefs.openAgentOnProject,
    showSelectionAgentButton: prefs.showSelectionAgentButton,
    keybindings: prefs.keybindings,
  };
}

function schedulePersist(prefs: GlyphraPrefs, theme?: string, language?: string) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void ipc.settingsSet(appSettings(prefs, theme, language)).catch(() => undefined);
  }, 75);
}

interface PrefsState extends GlyphraPrefs {
  hydrate: (settings: AppSettings) => void;
  persist: (theme?: string, language?: string) => void;
  setPref: <K extends keyof GlyphraPrefs>(key: K, value: GlyphraPrefs[K]) => void;
  resetEditor: () => void;
  resetKeybindings: () => void;
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  ...defaultPrefs,
  ...(legacyPrefs ?? {}),
  keybindings: legacyPrefs?.keybindings ?? DEFAULT_KEYBINDINGS.map((binding) => ({ ...binding })),

  hydrate: (settings) => {
    const next = {
      ...prefsFromSettings(settings),
      ...(legacyPrefs ?? {}),
    };
    set(next);
    applyImportedTheme(next.customTheme);
    if (legacyPrefs) {
      legacyPrefs = null;
      localStorage.removeItem(LEGACY_PREFS_KEY);
      schedulePersist(next, settings.theme, settings.language);
    }
  },

  persist: (theme, language) => schedulePersist(get(), theme, language),

  setPref: (key, value) => {
    set({ [key]: value } as Partial<GlyphraPrefs>);
    if (key === "customTheme") {
      applyImportedTheme(value as ImportedTheme | null);
    }
    schedulePersist(get());
  },

  resetEditor: () => {
    set({
      fontSize: defaultPrefs.fontSize,
      tabSize: defaultPrefs.tabSize,
      wordWrap: defaultPrefs.wordWrap,
      lineNumbers: defaultPrefs.lineNumbers,
      trimTrailingWhitespace: defaultPrefs.trimTrailingWhitespace,
      insertFinalNewline: defaultPrefs.insertFinalNewline,
      formatOnSave: defaultPrefs.formatOnSave,
      minimap: defaultPrefs.minimap,
      breadcrumbs: defaultPrefs.breadcrumbs,
      stickyScroll: defaultPrefs.stickyScroll,
      bracketPairColorization: defaultPrefs.bracketPairColorization,
      indentGuides: defaultPrefs.indentGuides,
      ghostText: defaultPrefs.ghostText,
      ghostTextDelayMs: defaultPrefs.ghostTextDelayMs,
      languageServer: defaultPrefs.languageServer,
      languageServerDisabled: [...defaultPrefs.languageServerDisabled],
      terminalWebgl: defaultPrefs.terminalWebgl,
    });
    schedulePersist(get());
  },

  resetKeybindings: () => {
    set({ keybindings: DEFAULT_KEYBINDINGS.map((binding) => ({ ...binding })) });
    schedulePersist(get());
  },
}));
