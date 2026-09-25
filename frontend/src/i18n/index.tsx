import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, type Discrepancy, type Note } from "../api/client";
import { en, type Messages } from "./en";
import { hu } from "./hu";

export const LANGUAGES = { en, hu } as const;
export type Language = keyof typeof LANGUAGES;
export type { Messages };

const STORAGE_KEY = "recon.language";

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LANGUAGES) return saved as Language;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("hu")
    ? "hu"
    : "en";
}

type Ctx = { language: Language; t: Messages; setLanguage: (l: Language) => void };
const I18nContext = createContext<Ctx>({ language: "en", t: en, setLanguage: () => {} });

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguageState] = useState<Language>(() => initial ?? initialLanguage());
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = (l: Language) => {
    setLanguageState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <I18nContext.Provider value={{ language, t: LANGUAGES[language], setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

/** The texts of the current language (English outside a provider, e.g. in isolated tests). */
export function useT(): Messages {
  return useContext(I18nContext).t;
}

export function useLanguage() {
  const { language, setLanguage } = useContext(I18nContext);
  return { language, setLanguage };
}

/** A server message in the current language (the English text if the code is unknown). */
export function noteText(t: Messages, note: Note): string {
  const format = t.messages[note.code];
  return format ? format(note.params ?? {}) : note.text;
}

export function discrepancyText(t: Messages, d: Discrepancy): string {
  const format = t.messages[d.code];
  return format ? format(d.params ?? {}) : d.message;
}

/** Translate a known API error code; otherwise fall back to the server's message. */
export function errorText(t: Messages, error: unknown): string {
  if (error instanceof ApiError) return t.errors[error.code] ?? error.message;
  return error instanceof Error ? error.message : String(error);
}
