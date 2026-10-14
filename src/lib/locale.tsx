import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Language } from "../shared/settings";
import { translate } from "../shared/i18n";
import { date, availability } from "./api";
import { defaultTimeZone, zoneOffset } from "../shared/time";

const LocaleContext = createContext<Language>("es");
const TimeZoneContext = createContext(defaultTimeZone);
export function LocaleProvider({
  language,
  children,
  documentLanguage = true,
  timeZone
}: {
  language: Language;
  children: ReactNode;
  documentLanguage?: boolean;
  timeZone?: string;
}) {
  const inheritedTimeZone = useContext(TimeZoneContext);
  useEffect(() => {
    if (documentLanguage) document.documentElement.lang = language;
  }, [language, documentLanguage]);
  return (
    <LocaleContext.Provider value={language}>
      <TimeZoneContext.Provider value={timeZone ?? inheritedTimeZone}>{children}</TimeZoneContext.Provider>
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  const language = useContext(LocaleContext);
  const timeZone = useContext(TimeZoneContext);
  return {
    language,
    timeZone,
    timeZoneLabel: `${timeZone} (${zoneOffset(timeZone)})`,
    t: (text: string, values?: Record<string, string | number>) =>
      translate(language, text, values),
    date: (value: number | null | undefined) => date(value, language, timeZone),
    availability: (stats: Parameters<typeof availability>[0]) =>
      availability(stats, language)
  };
}
