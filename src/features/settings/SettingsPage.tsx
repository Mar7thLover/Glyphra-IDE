import { ArrowLeft, Bot, Code2, Info, KeyRound, Palette } from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { useUiStore } from "@/lib/stores/uiStore";

import AboutSection from "./AboutSection";
import AgentSection from "./AgentSection";
import EditorSection from "./EditorSection";
import PersonalSection from "./PersonalSection";
import ProvidersSection from "./ProvidersSection";

type SettingsSectionId = "personal" | "models" | "editor" | "agent" | "about";

const sections: {
  id: SettingsSectionId;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { id: "personal", icon: Palette },
  { id: "models", icon: KeyRound },
  { id: "editor", icon: Code2 },
  { id: "agent", icon: Bot },
  { id: "about", icon: Info },
];

/** Full-page settings — replaces the IDE shell content while open. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const closeSettings = useUiStore((s) => s.closeSettings);
  const [section, setSection] = useState<SettingsSectionId>("personal");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
        <button
          type="button"
          onClick={closeSettings}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.6} />
          {t("settings.back")}
        </button>
        <span className="text-[12px] font-medium text-ink">{t("panel.settings")}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-panel px-2 py-3">
          {sections.map(({ id, icon: Icon }) => {
            const active = id === section;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[12px] transition-colors ${
                  active ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover/60 hover:text-ink"
                }`}
              >
                <Icon className="size-3.5 shrink-0 opacity-70" strokeWidth={1.6} />
                {t(`settings.nav.${id}`)}
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-8 py-6">
            <h1 className="mb-1 text-[15px] font-medium text-ink">
              {t(`settings.nav.${section}`)}
            </h1>
            <div className="mt-5">
              {section === "personal" && <PersonalSection />}
              {section === "models" && <ProvidersSection />}
              {section === "editor" && <EditorSection />}
              {section === "agent" && <AgentSection />}
              {section === "about" && <AboutSection />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
