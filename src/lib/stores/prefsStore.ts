import { create } from "zustand";

import type {
  AgentApprovalReviewer,
  AgentPermissionMode,
  StartableBackend,
} from "@/lib/acp/types";

const PREFS_KEY = "glyphra.prefs";

export interface GlyphraPrefs {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  defaultMode: AgentPermissionMode;
  defaultBackend: StartableBackend;
  defaultProviderId: string | null;
  defaultAgentModel: string | null;
  defaultReasoningEffort: string | null;
  defaultContextWindow: number | null;
  defaultFastMode: boolean;
  defaultApprovalReviewer: AgentApprovalReviewer;
  openAgentOnProject: boolean;
}

const defaults: GlyphraPrefs = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  defaultMode: "standard",
  defaultBackend: "auto",
  defaultProviderId: null,
  defaultAgentModel: null,
  defaultReasoningEffort: null,
  defaultContextWindow: null,
  defaultFastMode: false,
  defaultApprovalReviewer: "user",
  // Right Agent panel stays collapsed until the titlebar entry opens it.
  openAgentOnProject: false,
};

function readPrefs(): GlyphraPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...(JSON.parse(raw) as Partial<GlyphraPrefs>) };
  } catch {
    return { ...defaults };
  }
}

interface PrefsState extends GlyphraPrefs {
  setPref: <K extends keyof GlyphraPrefs>(key: K, value: GlyphraPrefs[K]) => void;
  resetEditor: () => void;
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  ...readPrefs(),

  setPref: (key, value) => {
    set({ [key]: value } as Partial<GlyphraPrefs>);
    const {
      fontSize,
      tabSize,
      wordWrap,
      lineNumbers,
      defaultMode,
      defaultBackend,
      defaultProviderId,
      defaultAgentModel,
      defaultReasoningEffort,
      defaultContextWindow,
      defaultFastMode,
      defaultApprovalReviewer,
      openAgentOnProject,
    } = get();
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        fontSize,
        tabSize,
        wordWrap,
        lineNumbers,
        defaultMode,
        defaultBackend,
        defaultProviderId,
        defaultAgentModel,
        defaultReasoningEffort,
        defaultContextWindow,
        defaultFastMode,
        defaultApprovalReviewer,
        openAgentOnProject,
      }),
    );
  },

  resetEditor: () => {
    get().setPref("fontSize", defaults.fontSize);
    get().setPref("tabSize", defaults.tabSize);
    get().setPref("wordWrap", defaults.wordWrap);
    get().setPref("lineNumbers", defaults.lineNumbers);
  },
}));
