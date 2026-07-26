import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs without a DOM on purpose (no jsdom dependency), but this
// module's whole job is writing to `documentElement` and `localStorage`.
// Install the two surfaces it touches before the stores are imported.
vi.hoisted(() => {
  const dataset: Record<string, string> = {};
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset } },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

vi.mock("@/app/i18n", () => ({
  default: { changeLanguage: vi.fn(), language: "en" },
}));

import i18n from "@/app/i18n";
import { useUiStore } from "@/lib/stores/uiStore";

import { applyAppearanceSettings, isTheme, isThemeVariant } from "./appearance";

describe("appearance settings", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.variant = "neutral";
    localStorage.clear();
    useUiStore.setState({ theme: "dark", variant: "neutral" });
    vi.mocked(i18n.changeLanguage).mockClear();
  });

  it("validates the persisted values", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isThemeVariant("contrast")).toBe(true);
    expect(isThemeVariant("aurora")).toBe(false);
  });

  it("applies theme, tone and language to the document", () => {
    applyAppearanceSettings({ theme: "light", themeVariant: "soft", language: "zh-CN" });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.variant).toBe("soft");
    expect(useUiStore.getState().theme).toBe("light");
    expect(useUiStore.getState().variant).toBe("soft");
    expect(i18n.changeLanguage).toHaveBeenCalledWith("zh-CN");
    expect(localStorage.getItem("glyphra.themeVariant")).toBe("soft");
    expect(localStorage.getItem("glyphra.lang")).toBe("zh-CN");
  });

  it("leaves the pre-paint choice alone for 'system' and unknown values", () => {
    applyAppearanceSettings({ theme: "system", themeVariant: "aurora", language: "system" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.variant).toBe("neutral");
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it("can switch language without claiming the localStorage preference", () => {
    applyAppearanceSettings(
      { theme: "dark", themeVariant: "neutral", language: "en" },
      { persistLanguage: false },
    );
    expect(i18n.changeLanguage).toHaveBeenCalledWith("en");
    expect(localStorage.getItem("glyphra.lang")).toBeNull();
  });
});
