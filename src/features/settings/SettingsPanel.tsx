import { Bot, Code2, Info, KeyRound, Palette } from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

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

export default function SettingsPanel() {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSectionId>("personal");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5">
        {sections.map(({ id, icon: Icon }) => {
          const active = id === section;
          return (
            <button
              key={id}
              type="button"
              title={t(`settings.nav.${id}`)}
              onClick={() => setSection(id)}
              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
                active ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              <Icon className="size-3" strokeWidth={1.6} />
              <span className="hidden min-[280px]:inline">{t(`settings.nav.${id}`)}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {section === "personal" && <PersonalSection />}
        {section === "models" && <ProvidersSection />}
        {section === "editor" && <EditorSection />}
        {section === "agent" && <AgentSection />}
        {section === "about" && <AboutSection />}
      </div>
    </div>
  );
}
