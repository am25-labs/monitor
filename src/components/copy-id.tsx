import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "../lib/locale";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function CopyId({ id }: { id: string }) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<{ success: boolean } | null>(null);
  const label = feedback?.success ? t("UUID copiado") : t("Copiar UUID");

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timeout);
  }, [feedback]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setFeedback({ success: true });
    } catch {
      setFeedback({ success: false });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <span className="min-w-0 break-all font-mono text-xs">{id}</span>
        <Tooltip>
          <TooltipTrigger
            render={<Button type="button" variant="ghost" size="icon-xs" />}
            aria-label={label}
            onClick={() => void copy()}
          >
            {feedback?.success ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
      <span role="status" className="sr-only">{feedback?.success ? t("UUID copiado") : ""}</span>
      {feedback && !feedback.success && <span role="alert" className="text-xs text-destructive">{t("No se pudo copiar el UUID.")}</span>}
    </div>
  );
}
