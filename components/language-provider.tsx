"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { translate, type Lang, type TKey } from "@/lib/i18n";

// Language is an external store (localStorage) so any component can flip
// it and every consumer re-renders without prop drilling or effects
// calling setState.

const LANG_KEY = "siroq.lang";
const LANG_EVENT = "siroq:lang";

function subscribeLang(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(LANG_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LANG_EVENT, callback);
  };
}

function getLangSnapshot(): Lang {
  try {
    return window.localStorage.getItem(LANG_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

function getServerLang(): Lang {
  return "en";
}

function setStoredLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Storage may be unavailable; the choice stays session-only.
  }
  window.dispatchEvent(new Event(LANG_EVENT));
}

interface LanguageContextValue {
  lang: Lang;
  t: (key: TKey) => string;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  t: (key) => translate("en", key),
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getServerLang);

  // Sync document direction/language with the active choice.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
    return () => {
      root.dir = "ltr";
      root.lang = "en";
    };
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      t: (key: TKey) => translate(lang, key),
      setLang: setStoredLang,
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  return useContext(LanguageContext);
}
