import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import zhCN from "@/locales/zh-CN.json";

const stored = localStorage.getItem("glyphra.lang");
const system = navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: stored ?? system,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
