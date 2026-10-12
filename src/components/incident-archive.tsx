import { useState } from "react";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";
import type { PublicIncidentView } from "../shared/incidents";
import { IncidentCard } from "./incident-card";
import { Button } from "./ui/button";
import { Notice, Nothing } from "./common";

export function IncidentArchive({ slug }: { slug: string }) {
  const { t } = useLocale();
  const [items, setItems] = useState<PublicIncidentView[]>([]);
  const [cursor, setCursor] = useState<{ time: number; id: string } | null>(
    null
  );
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ archive: "1" });
      if (cursor) {
        params.set("before", String(cursor.time));
        params.set("id", cursor.id);
      }
      const data = await api<{
        incidents: PublicIncidentView[];
        nextCursor: typeof cursor;
      }>(`public/${slug}?${params}`);
      setItems((previous) => [
        ...previous,
        ...data.incidents.filter((i) => !previous.some((p) => p.id === i.id))
      ]);
      setCursor(data.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Falló la consulta."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {loaded && (
        <h2 className="text-lg font-semibold">
          {t("Archivo de incidentes · últimos 90 días")}
        </h2>
      )}
      {items.map((i) => (
        <IncidentCard key={i.id} incident={i} />
      ))}
      {loaded && !items.length && (
        <Nothing description={t("No hay incidentes para mostrar.")} />
      )}
      <Notice message={error} destructive />
      {(!loaded || cursor) && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void load()}
          disabled={busy}
        >
          {t(busy ? "Cargando…" : "Ver más")}
        </Button>
      )}
    </div>
  );
}
