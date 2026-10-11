import type { Language } from "./settings";
import { english } from "./translations";

export function translate(
  language: Language,
  text: string,
  values: Record<string, string | number> = {}
) {
  const message = language === "en" ? (english[text] ?? text) : text;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    values[key] === undefined ? match : String(values[key])
  );
}
export const locales: Record<Language, string> = { es: "es-SV", en: "en-US" };
