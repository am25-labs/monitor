import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
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
    <button type="button" onClick={() => void copy()} aria-label={t("Copiar {label}", { label })} title={feedback === true ? t("Copiado al portapapeles") : t("Copiar {label}", { label })} className={cn("inline-flex max-w-full cursor-copy select-text items-center gap-2 text-left font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring", field && "w-full justify-between rounded-lg border bg-transparent px-3 py-2 text-sm")}>
      <span className="min-w-0 break-all">{value}</span>
      {feedback === true ? <Check className="size-4 shrink-0 text-success" aria-hidden="true" /> : <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </button>
    <span role="status" className="sr-only">{feedback === true ? t("Copiado al portapapeles") : ""}</span>
    {feedback === false && <span role="alert" className="text-xs text-destructive">{t("No se pudo copiar. Selecciona el texto y cópialo manualmente.")}</span>}
  </span>;
}
