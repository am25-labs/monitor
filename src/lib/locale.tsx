import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Language } from "../shared/settings";
import { translate } from "../shared/i18n";
import { date, availability } from "./api";

const LocaleContext = createContext<Language>("es");
export function LocaleProvider({
  language,
  children
}: {
  language: Language;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LocaleContext.Provider value={language}>{children}</LocaleContext.Provider>
  );
}
export function useLocale() {
  const language = useContext(LocaleContext);
  return {
    language,
    t: (text: string, values?: Record<string, string | number>) =>
      translate(language, text, values),
    date: (value: number | null | undefined) => date(value, language),
    availability: (stats: Parameters<typeof availability>[0]) =>
      availability(stats, language)
  };
}
