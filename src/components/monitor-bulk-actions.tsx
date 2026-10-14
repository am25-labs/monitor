import { useState } from "react";
import type { Snapshot } from "../lib/api";
import { useLocale } from "../lib/locale";
import { useMutation } from "../lib/mutations";
import type { BulkMonitorInput } from "../shared/bulk-monitors";
import { ChoiceSelect } from "./choice-select";
import { FormField, Notice } from "./common";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { FieldDescription, FieldGroup } from "./ui/field";

export function MonitorBulkActions({ data, ids, busy, onBusyChange, onComplete, onClear }: {
  data: Snapshot;
  ids: string[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const mutation = useMutation();
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const selected = data.monitors.filter((monitor) => ids.includes(monitor.id));
  const projects = new Set(selected.map((monitor) => monitor.project_id));
  const groups = projects.size === 1 ? data.groups.filter((group) => projects.has(group.project_id)) : [];
  const labels = {
    project: t("Cambiar de proyecto"),
    group: t("Cambiar de grupo"),
    pause: t("Pausar"),
    resume: t("Reanudar"),
    "maintenance-start": t("Activar mantenimiento"),
    "maintenance-end": t("Finalizar mantenimiento")
  };
  function close() {
    if (busy) return;
    setAction("");
    setError("");
  }
  async function apply() {
    let payload: BulkMonitorInput;
    if (action === "project") payload = { action, ids, project_id: target };
    else if (action === "group") payload = { action, ids, group_id: target || null };
    else if (action === "pause" || action === "resume") payload = { action: "pause", ids, paused: action === "pause" };
    else payload = { action: "maintenance", ids, enabled: action === "maintenance-start" };
    onBusyChange(true);
    setError("");
    try {
      await mutation.mutate("admin/monitors/bulk", "POST", payload);
      setAction("");
      onComplete();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Falló la operación."));
    } finally {
      onBusyChange(false);
    }
  }
  return <>
    <span className="text-sm text-muted-foreground" role="status">{t("{count} seleccionados", { count: ids.length })}</span>
    <ChoiceSelect
      className="w-full sm:w-56"
      aria-label={t("Acciones en lote")}
      placeholder={t("Acciones en lote")}
      value={action}
      disabled={busy || !ids.length}
      onValueChange={(value) => { setTarget(""); setError(""); setAction(value); }}
      options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
    />
    <Button variant="ghost" disabled={busy} onClick={onClear}>{t("Limpiar selección")}</Button>
    <AlertDialog open={Boolean(action)} onOpenChange={(open) => { if (!open) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels[action as keyof typeof labels]}</AlertDialogTitle>
          <AlertDialogDescription>{t("La acción se aplicará a {count} monitores seleccionados.", { count: ids.length })}</AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
        {action === "project" && <FormField id="bulk-project" label={t("Proyecto de destino")}>
          <ChoiceSelect id="bulk-project" value={target} onValueChange={setTarget} disabled={busy} options={data.projects.map((project) => ({ value: project.id, label: project.name }))} />
          <FieldDescription>{t("Los monitores que cambien de proyecto quedarán sin grupo.")}</FieldDescription>
        </FormField>}
        {action === "group" && <FormField id="bulk-group" label={t("Grupo de destino")}>
          <ChoiceSelect id="bulk-group" value={target} onValueChange={setTarget} disabled={busy} options={[{ value: "", label: t("Sin grupo") }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />
          {projects.size > 1 && <FieldDescription>{t("Para asignar un grupo, selecciona monitores de un mismo proyecto. Puedes quitar el grupo de toda la selección.")}</FieldDescription>}
        </FormField>}
        </FieldGroup>
        {action === "maintenance-end" && <p className="text-sm text-muted-foreground">{t("Finaliza los mantenimientos individuales activos. Los mantenimientos de grupo, proyecto o instancia conservan su vigencia.")}</p>}
        <Notice message={error} destructive />
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>{t("Cancelar")}</Button>
          <Button disabled={busy || !ids.length || (action === "project" && !target)} onClick={() => void apply()}>{busy ? t("Procesando…") : t("Aplicar a seleccionados")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
