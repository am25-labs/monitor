import { useLocation } from "react-router-dom";
import { useRefresh } from "../lib/api";
import type { GeneralSettings, Language } from "../shared/settings";
import { translate } from "../shared/i18n";

export function NotFound() {
  const { pathname } = useLocation();
  const { data } = useRefresh<GeneralSettings>(pathname.startsWith("/app/") ? "admin/settings/general" : "");
  const language: Language = data?.language ?? (document.documentElement.lang === "en" ? "en" : "es");
  return <main className="p-8">{translate(language, "Página no encontrada.")}</main>;
}
