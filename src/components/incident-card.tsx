import { useState } from "react";
import { useLocale } from "../lib/locale";
import { stageLabels, type PublicIncidentView } from "../shared/incidents";
import { Panel, StatusBadge } from "./common";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";

export function IncidentCard({ incident, published }: { incident: PublicIncidentView; published?: boolean }) {
  const { t, date } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const latest = incident.updates.at(-1);
  return (
    <Panel title={incident.title}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={incident.impact} />
          <Badge variant="outline">{t(stageLabels[incident.stage])}</Badge>
          {published !== undefined && <Badge variant="outline">{t(published ? "Publicado" : "Borrador")}</Badge>}
          {incident.monitors.map((m) => (
            <Badge key={m.id} variant="secondary">
              {m.name}
            </Badge>
          ))}
        </div>
        {latest && (
          <p className="whitespace-pre-wrap break-words text-sm">
            {latest.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("Última actualización:")} {date(incident.updated_at)}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={`timeline-${incident.id}`}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "Ocultar actualizaciones" : "Ver actualizaciones")}
        </Button>
        {expanded && (
          <div id={`timeline-${incident.id}`} className="flex flex-col gap-4">
            <Separator />
            <ol className="flex flex-col gap-4">
              {[...incident.updates].reverse().map((update) => (
                <li key={update.id} className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {t(stageLabels[update.stage])}
                    </Badge>
                    <StatusBadge status={update.impact} />
                    <span className="text-xs text-muted-foreground">
                      {date(update.created_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">
                    {update.message}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  );
}
