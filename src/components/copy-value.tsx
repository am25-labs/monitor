import { useEffect, useState } from "react";
import { useLocale } from "../lib/locale";
import { cn } from "../lib/utils";

export function CopyValue({ value, label, field = false }: { value: string; label: string; field?: boolean }) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<boolean | null>(null);
  useEffect(() => {
    if (feedback === null) return;
    const timeout = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timeout);
  }, [feedback]);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setFeedback(true); }
    catch { setFeedback(false); }
  }
  return <span className={cn("inline-flex min-w-0 flex-col items-start gap-1", field && "w-full")}>
    <button type="button" onClick={() => void copy()} aria-label={t("Copiar {label}", { label })} title={t("Copiar {label}", { label })} className={cn("max-w-full cursor-copy select-text break-all text-left font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring", field && "w-full rounded-lg border bg-transparent px-3 py-2 text-sm")}>
      {value}
    </button>
    <span role="status" className={cn("text-xs", feedback === false ? "text-destructive" : "text-muted-foreground")}>
      {feedback === true ? t("Copiado al portapapeles") : feedback === false ? t("No se pudo copiar. Selecciona el texto y cópialo manualmente.") : ""}
    </span>
  </span>;
}
