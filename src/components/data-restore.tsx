import { useState } from "react";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";
import { backupLimit, parseBackup, type Backup } from "../shared/backup";
import { FormField, Notice, Panel } from "./common";
import { ConfirmDialog } from "./confirm-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FieldDescription, FieldGroup } from "./ui/field";

export function DataRestore({ onChange }: { onChange: () => Promise<void> }) {
  const { t } = useLocale();
  const [backup, setBackup] = useState<Backup | null>(null);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load(file?: File) {
    setBackup(null);
    setError("");
    setRestored(false);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > backupLimit) throw new Error("La copia supera el límite de 20 MB.");
      let input: unknown;
      try { input = JSON.parse(await file.text()); }
      catch { throw new Error("La copia no es un JSON de Monitor completo y compatible."); }
      setBackup(parseBackup(input));
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo leer la copia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("Restaurar copia")} description={t("Selecciona un JSON descargado de Monitor. Antes de restaurar, revisa el alcance y confirma el reemplazo de los datos.")}>
      <div className="flex flex-col gap-4">
        <FieldGroup>
          <FormField id="restore-file" label={t("Archivo JSON")}>
            <Input id="restore-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void load(event.target.files?.[0])} />
            <FieldDescription>{t("Hasta 20 MB. La copia debe poder descifrarse con la CONFIG_KEY que ya usa esta instalación.")}</FieldDescription>
          </FormField>
          {backup && (
            <div className="flex flex-col gap-2">
              <FieldDescription>{t("{projects} proyectos y {monitors} monitores en la copia.", { projects: backup.data.projects.length, monitors: backup.data.monitors.length })}</FieldDescription>
              <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                {backup.data.projects.map((project) => (
                  <li key={String(project.id)} className="flex flex-col gap-1">
                    <span>{project.name}</span>
                    <span className="break-all font-mono text-xs text-muted-foreground">{project.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FieldDescription>{t("Las tareas y notificaciones pendientes de la copia se cancelan para evitar ejecutarlas o enviarlas otra vez. Las comprobaciones nuevas se reanudan después de restaurar.")}</FieldDescription>
        </FieldGroup>
        <Notice message={error} destructive />
        {restored && <Notice message={t("Copia restaurada.")} />}
        <Button variant="destructive" disabled={!backup || busy} className="self-end" onClick={() => setConfirmOpen(true)}>{t("Restaurar copia")}</Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t("¿Restaurar esta copia?")}
          description={backup?.scope.type === "full"
            ? t("Se reemplazarán todos los proyectos, monitores, historial y ajustes actuales por los de la copia. Esta acción no se puede deshacer.")
            : t("Se reemplazarán los proyectos incluidos en la copia y sus datos relacionados. Los demás proyectos, ajustes y mantenimientos globales se conservarán. Esta acción no se puede deshacer.")}
          action={t("Restaurar y reemplazar")}
          destructive
          onConfirm={async () => {
            if (!backup) return;
            setBusy(true);
            try {
              await api("admin/settings/restore", "POST", { confirmation: "RESTORE_BACKUP", backup });
              setRestored(true);
              setBackup(null);
              await onChange();
            } finally { setBusy(false); }
          }}
        />
      </div>
    </Panel>
  );
}
