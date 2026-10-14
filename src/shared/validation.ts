import type { ZodError } from "zod";
import { en, es } from "zod/locales";
import type { Language } from "./settings";
import { translate } from "./i18n";
import { english } from "./translations";

export function validationMessage(error: ZodError, language: Language) {
  const localize = (language === "en" ? en() : es()).localeError;
  return error.issues.map((issue) => {
    if (issue.code === "custom" || Object.hasOwn(english, issue.message))
      return translate(language, issue.message);
    if (issue.code === "invalid_type")
      return translate(language, "El valor no tiene el tipo esperado.");
    const message = localize({ ...issue, input: undefined });
    return (typeof message === "string" ? message : message?.message) ?? translate(language, "Revisa los datos.");
  }).join(" ");
}
