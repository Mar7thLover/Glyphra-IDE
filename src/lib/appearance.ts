import i18n from "@/app/i18n";
import { useUiStore, type Theme, type ThemeVariant } from "@/lib/stores/uiStore";

/**
 * Apply the appearance half of persisted settings.
 *
 * Shared by every window's boot path and its `settings-changed` listener, so a
 * theme change in one window reaches the others without three copies of the
 * same validation drifting apart.
 */
export interface AppearanceSettings {
  theme: string;
  themeVariant: string;
  language: string;
}

export function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark";
}

export function isThemeVariant(value: string): value is ThemeVariant {
  return value === "neutral" || value === "soft" || value === "contrast";
}

export function applyAppearanceSettings(
  settings: AppearanceSettings,
  options: { persistLanguage?: boolean } = {},
) {
  const ui = useUiStore.getState();
  // `system` and anything unrecognised leave whatever index.html resolved
  // before first paint in place.
  if (isTheme(settings.theme)) ui.setTheme(settings.theme);
  if (isThemeVariant(settings.themeVariant)) ui.setVariant(settings.themeVariant);
  if (settings.language === "en" || settings.language === "zh-CN") {
    void i18n.changeLanguage(settings.language);
    if (options.persistLanguage !== false && typeof localStorage !== "undefined") {
      localStorage.setItem("glyphra.lang", settings.language);
    }
  }
}
