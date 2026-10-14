import { Incidents } from "../components/incidents";
import { useLocale } from "../lib/locale";
import { Settings } from "../components/settings";
import { LocaleProvider } from "../lib/locale";
import { Overview } from "../components/overview";
import { Metrics } from "../components/metrics";
import { ConfirmDialog } from "../components/confirm-dialog";
import { CopyId } from "../components/copy-id";
import { useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  LayoutDashboard,
  TriangleAlert,
  Folder,
  Globe,
  Moon,
  Sun,
  Wrench,
  RefreshCw,
  LogOut,
  Plus,
  ArrowLeft,
  Settings as SettingsIcon
} from "lucide-react";
import { api, useRefresh, type Snapshot } from "../lib/api";
import { RefreshProvider, useRefreshGroup } from "../lib/refresh-context";
import { useMutation, type MutationMethod } from "../lib/mutations";
import { Spinner } from "../components/ui/spinner";
import type { SafeMonitor, Window } from "../shared/types";
import { cn } from "../lib/utils";
import { Notice, Nothing, Panel, StatusBadge } from "../components/common";
import { MonitorForm } from "../components/monitor-form";
import { ResourceForm, type Resource } from "../components/resource-form";
import { MonitorTimeline, HistoryStrip } from "../components/monitor-timeline";
import type { MonitorHistory } from "../shared/types";
import { History } from "../components/history";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table";
import { ChoiceSelect } from "../components/choice-select";
import { Checkbox } from "../components/ui/checkbox";
import { MonitorBulkActions } from "../components/monitor-bulk-actions";
import { visibleSelection } from "../shared/bulk-monitors";

type Editor =
  | { resource: Resource; value?: Record<string, unknown> }
  | { resource: "monitors"; monitor?: SafeMonitor };
export function Dashboard({
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
}) {
  return <RefreshProvider><DashboardContent theme={theme} toggleTheme={toggleTheme} /></RefreshProvider>;
}
function DashboardContent({ theme, toggleTheme }: { theme: string; toggleTheme: () => void }) {
  const snapshot = useRefresh<Snapshot>("admin/snapshot");
  return (
    <LocaleProvider language={snapshot.data?.settings.general.language ?? "es"} timeZone={snapshot.data?.settings.general.timeZone}>
      <DashboardView theme={theme} toggleTheme={toggleTheme} {...snapshot} />
    </LocaleProvider>
  );
}
function DashboardView({
  data,
  error,
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
  data: Snapshot | null;
  error: string;
}) {
  const { t, date } = useLocale();
  const groupRefresh = useRefreshGroup();
  const mutation = useMutation();
  const [refreshing, setRefreshing] = useState(false);
  const { section = "overview", id } = useParams(),
    navigate = useNavigate();
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<{
      resource: string;
      id: string;
    } | null>(null);
  const recent = useRefresh<{ updatedAt: number; short: (MonitorHistory["short"][number] & { monitor_id: string })[] }>(
    section === "monitors" && !id ? "admin/monitor-history" : ""
  );
  async function refresh() {
    setRefreshing(true);
    try { await groupRefresh.refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : t("Falló la consulta.")); }
    finally { setRefreshing(false); }
  }
  const [filter, setFilter] = useState(""),
    [project, setProject] = useState(""),
    [group, setGroup] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  async function mutate(path: string, method: MutationMethod, payload?: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const result = await mutation.mutate<{ token?: string }>(
        `admin/${path}`,
        method,
        payload
      );
      if (result.token)
        setNotice(
          t(
            "Guarda este token de heartbeat; no se volverá a mostrar: {token}",
            { token: result.token }
          )
        );
      return result;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("Falló la operación."));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function save(resource: Resource, v: unknown, id?: string) {
    await mutate(`${resource}${id ? `/${id}` : ""}`, id ? "PUT" : "POST", v);
    setEditor(null);
  }
  async function saveMonitor(v: unknown, id?: string) {
    await mutate(`monitors${id ? `/${id}` : ""}`, id ? "PUT" : "POST", v);
    setEditor(null);
  }
  function remove(resource: string, id: string) {
    setDeleteTarget({ resource, id });
  }
  async function endMaintenance(windows: Window[]) {
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      await mutation.batch(
        windows.map((w) => ({
          path: `admin/maintenance/${w.id}`,
          method: "PUT" as const,
          payload: {
            ...w,
            ends_at: Math.max(w.starts_at + 1, now)
          }
        }))
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.monitors.find((m) => m.id === id);
  const now = Math.floor(Date.now() / 1000);
  const monitorMaintenance =
    data?.maintenance.filter(
      (w) =>
        w.scope === "monitor" &&
        w.target_id === selected?.id &&
        w.starts_at <= now &&
        (w.ends_at === null || w.ends_at > now)
    ) ?? [];
  const globalMaintenance =
    data?.maintenance.filter(
      (w) =>
        w.scope === "global" &&
        w.starts_at <= now &&
        (w.ends_at === null || w.ends_at > now)
    ) ?? [];
  const visible =
    data?.monitors.filter(
      (m) =>
        (!project || m.project_id === project) &&
        (!group || m.group_id === group) &&
        m.name.toLowerCase().includes(filter.toLowerCase())
    ) ?? [];
  const selectedIds = visibleSelection(selection, visible);
  function selectMonitor(monitorId: string, checked: boolean) {
    setSelection(checked ? [...selectedIds, monitorId] : selectedIds.filter((id) => id !== monitorId));
  }
  const titles: Record<string, string> = {
    overview: t("Resumen"),
    metrics: t("Métricas"),
    monitors: t("Monitores"),
    projects: t("Proyectos y grupos"),
    pages: t("Páginas públicas"),
    incidents: t("Incidentes"),
    maintenance: t("Mantenimiento"),
    settings: t("Ajustes")
  };
  const nav = [
    { to: "overview", label: t("Resumen"), icon: LayoutDashboard },
    { to: "monitors", label: t("Monitores"), icon: Activity },
    { to: "projects", label: t("Proyectos y grupos"), icon: Folder },
    { to: "pages", label: t("Páginas públicas"), icon: Globe },
    { to: "incidents", label: t("Incidentes"), icon: TriangleAlert },
    { to: "maintenance", label: t("Mantenimiento"), icon: Wrench },
    { to: "settings", label: t("Ajustes"), icon: SettingsIcon }
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b bg-card p-5 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <Link
          to="/app/"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          AM25 Monitor
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Tu infraestructura, en observación")}
        </p>
        <div className="mt-4 lg:hidden">
          <ChoiceSelect
            aria-label={t("Navegación principal")}
            value={section === "metrics" ? "overview" : section}
            options={nav.map((item) => ({ value: item.to, label: item.label }))}
            onValueChange={(value) => {
              setEditor(null);
              setNotice("");
              navigate(`/app/${value}`);
            }}
          />
        </div>
        <nav
          className="mt-6 hidden flex-col gap-1 lg:flex"
          aria-label={t("Navegación principal")}
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={`/app/${n.to}`}
              onClick={() => {
                setEditor(null);
                setNotice("");
              }}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent"
                )
              }
            >
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-8 hidden text-xs text-muted-foreground lg:block">
          {t("Historial completo · 6 meses")}
        </p>
      </aside>
      <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6 p-5 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {selected?.name ?? titles[section] ?? t("Monitor")}
              </h1>
              {section === "monitors" && selected && (
                <StatusBadge status={selected.display_status} />
              )}
            </div>
            {section === "monitors" && selected && (
              <CopyId key={selected.id} id={selected.id} />
            )}
            <p className="text-sm text-muted-foreground">
              {data?.settings.environment === "local"
                ? t("Entorno local · notificaciones interceptadas")
                : t("Actualización automática cada 30 segundos")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t(refreshing ? "Actualizando…" : "Actualizar")}
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? <Spinner aria-label={t("Actualizando…")} /> : <RefreshCw />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Cambiar tema")}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            {data?.settings.environment !== "local" && (
              <a
                href="/cdn-cgi/access/logout"
                className={buttonVariants({ variant: "outline" })}
              >
                <LogOut />
                {t("Cerrar sesión")}
              </a>
            )}
          </div>
        </header>
        <Notice message={error} destructive />
        <Notice message={notice} />
        {!data && !error && (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-80 w-full" />
          </>
        )}
        {data && (
          <>
            {editor &&
              (editor.resource === "monitors" ? (
                <MonitorForm
                  key={editor.monitor?.id ?? "new"}
                  data={data}
                  monitor={editor.monitor}
                  onSave={saveMonitor}
                  onCancel={() => setEditor(null)}
                />
              ) : (
                <ResourceForm
                  key={`${editor.resource}-${editor.value?.id ?? "new"}`}
                  resource={editor.resource}
                  data={data}
                  value={editor.value}
                  onSave={save}
                  onCancel={() => setEditor(null)}
                />
              ))}
            {section === "incidents" && <Incidents data={data} />}
            {section === "settings" && (
              <Settings data={data} />
            )}
            {section === "overview" && (
              <Overview
                data={data}
                busy={busy}
                onRetry={async (id) => {
                  await mutate(`notifications/${id}/retry`, "POST", {});
                }}
              />
            )}
            {section === "metrics" && <Metrics data={data} />}
            {section === "monitors" && selected && (
              <>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <Button
                    variant="ghost"
                    className="self-start"
                    onClick={() => navigate("/app/monitors")}
                  >
                    <ArrowLeft data-icon="inline-start" />
                    {t("Volver")}
                  </Button>
                  <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
                    <Button variant="outline" onClick={() => navigate(`/app/incidents?monitor=${selected.id}`)}>{t("Incidentes")}</Button>
                    <Button
                      onClick={() =>
                        setEditor({ resource: "monitors", monitor: selected })
                      }
                    >
                      {t("Editar")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`monitors/${selected.id}/pause`, "POST", {
                          paused: !selected.paused
                        }).catch(() => undefined)
                      }
                    >
                      {selected.paused ? t("Reactivar") : t("Pausar")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        (selected.display_status === "maintenance" &&
                          !monitorMaintenance.length)
                      }
                      onClick={() =>
                        monitorMaintenance.length
                          ? void endMaintenance(monitorMaintenance)
                          : void mutate("maintenance", "POST", {
                              scope: "monitor",
                              target_id: selected.id,
                              title: t("Mantenimiento de {name}", {
                                name: selected.name
                              }),
                              ends_at: null,
                              starts_at: Math.floor(Date.now() / 1000)
                            }).catch(() => undefined)
                      }
                    >
                      {monitorMaintenance.length
                        ? t("Finalizar mantenimiento")
                        : t("Activar mantenimiento")}
                    </Button>
                    {selected.kind !== "heartbeat" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void api<{
                            diagnostic: string;
                            latency: number | null;
                          }>(`admin/monitors/${selected.id}/test`, "POST", {})
                            .then((r) =>
                              setNotice(
                                `${t(r.diagnostic)}${r.latency !== null ? ` · ${r.latency} ms` : ""}`
                              )
                            )
                            .catch((e) => setNotice(String(e.message)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {t("Probar sin registrar")}
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => {
                        remove("monitors", selected.id);
                      }}
                    >
                      {t("Eliminar")}
                    </Button>
                  </div>
                </div>
                <Panel title={t("Resumen del monitor")}>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">
                        {t("Última comprobación")}
                      </dt>
                      <dd>{date(selected.last_checked)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {t("Última latencia")}
                      </dt>
                      <dd>
                        {selected.last_latency === null
                          ? t("Sin datos")
                          : `${selected.last_latency} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {t("Frecuencia")}
                      </dt>
                      <dd>
                        {t(selected.interval_seconds === 60 ? "{count} minuto" : "{count} minutos", {
                          count: selected.interval_seconds / 60
                        })}
                      </dd>
                    </div>
                  </dl>
                </Panel>
                <MonitorTimeline key={`timeline-${selected.id}`} monitor={selected} />
                <History key={selected.id} monitor={selected} />
              </>
            )}
            {section === "monitors" && !id && (
              <>
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
                    <Input
                      aria-label={t("Buscar monitores")}
                      placeholder={t("Buscar monitores…")}
                      className="w-full min-w-0"
                      value={filter}
                      onChange={(e) => { setFilter(e.target.value); setSelection([]); }}
                    />
                    <ChoiceSelect
                      aria-label={t("Filtrar por proyecto")}
                      value={project}
                      onValueChange={(value) => {
                        setProject(value);
                        setGroup("");
                        setSelection([]);
                      }}
                      options={[
                        { value: "", label: t("Todos los proyectos") },
                        ...data.projects.map((p) => ({
                          value: p.id,
                          label: p.name
                        }))
                      ]}
                    />
                    <ChoiceSelect
                      aria-label={t("Filtrar por grupo")}
                      value={group}
                      onValueChange={(value) => { setGroup(value); setSelection([]); }}
                      options={[
                        { value: "", label: t("Todos los grupos") },
                        ...data.groups
                          .filter((g) => !project || g.project_id === project)
                          .map((g) => ({ value: g.id, label: g.name }))
                      ]}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={busy || !data.projects.length || data.monitors.length >= 100}
                      onClick={() => setEditor({ resource: "monitors" })}
                    >
                      <Plus data-icon="inline-start" />
                      {t("Nuevo monitor")}
                    </Button>
                    {selectedIds.length > 0 && <MonitorBulkActions
                      data={data}
                      ids={selectedIds}
                      busy={busy}
                      onBusyChange={setBusy}
                      onClear={() => setSelection([])}
                      onComplete={() => { setSelection([]); setNotice(t("Acción aplicada a los monitores seleccionados.")); }}
                    />}
                  </div>
                </div>
                <Notice message={recent.error} destructive />
                <Panel
                  title={t("Monitores")}
                  description={t("{count} de 100 configurados", {
                    count: data.monitors.length
                  })}
                >
                  {visible.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox aria-label={t("Seleccionar todos los monitores visibles")} disabled={busy} checked={selectedIds.length === visible.length} indeterminate={selectedIds.length > 0 && selectedIds.length < visible.length} onCheckedChange={(checked) => setSelection(checked ? visible.map((monitor) => monitor.id) : [])} />
                          </TableHead>
                          <TableHead>{t("Nombre")}</TableHead>
                          <TableHead>{t("Proyecto / grupo")}</TableHead>
                          <TableHead>{t("Estado")}</TableHead>
                          <TableHead className="w-px">{t("Última hora")}</TableHead>
                          <TableHead>{t("Latencia")}</TableHead>
                          <TableHead>{t("Última comprobación")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((m) => (
                          <TableRow key={m.id} data-state={selectedIds.includes(m.id) ? "selected" : undefined}>
                            <TableCell>
                              <Checkbox aria-label={t("Seleccionar {name}", { name: m.name })} checked={selectedIds.includes(m.id)} disabled={busy} onCheckedChange={(checked) => selectMonitor(m.id, checked)} />
                            </TableCell>
                            <TableCell>
                              <Link
                                className="font-medium hover:underline"
                                to={`/app/monitors/${m.id}`}
                              >
                                {m.name}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {m.kind.toUpperCase()}
                              </p>
                            </TableCell>
                            <TableCell>
                              {
                                data.projects.find((p) => p.id === m.project_id)
                                  ?.name
                              }
                              {m.group_id
                                ? ` / ${data.groups.find((g) => g.id === m.group_id)?.name}`
                                : ""}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={m.display_status} />
                            </TableCell>
                            <TableCell>
                              <div className="w-max">
                                {recent.data ? <HistoryStrip range="1h" updatedAt={recent.data.updatedAt} short={recent.data.short.filter((stat) => stat.monitor_id === m.id)} stats={[]} hourly={[]} compact /> : <Skeleton className="h-4 w-18" />}
                              </div>
                            </TableCell>
                            <TableCell>
                              {m.last_latency === null
                                ? "—"
                                : `${m.last_latency} ms`}
                            </TableCell>
                            <TableCell>{date(m.last_checked)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <Nothing
                      description={
                        data.monitors.length
                          ? t("No hay monitores para estos filtros.")
                          : data.projects.length
                            ? t("Agrega tu primer monitor.")
                            : t("Crea primero un proyecto en Proyectos y grupos.")
                      }
                    />
                  )}
                </Panel>
              </>
            )}
            {section === "monitors" && id && !selected && (
              <Nothing
                title={t("Monitor no encontrado")}
                description={t("Puede haber sido eliminado.")}
              />
            )}
            {section === "projects" && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setEditor({ resource: "projects" })}>
                    {t("Crear proyecto")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!data.projects.length}
                    onClick={() => setEditor({ resource: "groups" })}
                  >
                    {t("Crear grupo")}
                  </Button>
                </div>
                {data.projects.length ? (
                  data.projects.map((p) => (
                    <Panel
                      key={p.id}
                      title={p.name}
                      id={p.id}
                      description={p.description}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setEditor({
                                resource: "projects",
                                value: { ...p }
                              })
                            }
                          >
                            {t("Editar proyecto")}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => remove("projects", p.id)}
                          >
                            {t("Eliminar")}
                          </Button>
                          <Link
                            className={buttonVariants({ variant: "outline" })}
                            to="/app/monitors"
                            onClick={() => {
                              setProject(p.id);
                              setGroup("");
                            }}
                          >
                            {t("Ver monitores")}
                          </Link>
                        </div>
                        {data.groups
                          .filter((g) => g.project_id === p.id)
                          .map((g) => (
                            <div
                              key={g.id}
                              className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <span>
                                {g.name} ·{" "}
                                {
                                  data.monitors.filter(
                                    (m) => m.group_id === g.id
                                  ).length
                                }{" "}
                                {t("monitores")}
                              </span>
                              <div className="grid grid-cols-2 gap-2 sm:flex">
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    setEditor({
                                      resource: "groups",
                                      value: { ...g }
                                    })
                                  }
                                >
                                  {t("Editar")}
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => remove("groups", g.id)}
                                >
                                  {t("Eliminar")}
                                </Button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </Panel>
                  ))
                ) : (
                  <Nothing
                    description={t(
                      "Crea proyectos para organizar tus monitores."
                    )}
                  />
                )}
              </>
            )}
            {section === "pages" && (
              <>
                <Button
                  className="self-start"
                  disabled={!data.projects.length}
                  onClick={() => setEditor({ resource: "pages" })}
                >
                  {t("Crear página pública")}
                </Button>
                {data.pages.length ? (
                  data.pages.map((p) => (
                    <Panel
                      key={p.id}
                      title={p.title}
                      description={p.description}
                    >
                      <div className="flex flex-col gap-3">
                        <span className="text-muted-foreground">
                          {p.published ? t("Publicada") : t("Borrador")} ·
                          /status/
                          {p.slug}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {p.published && (
                            <a
                              className={buttonVariants({ variant: "outline" })}
                              href={`/status/${p.slug}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("Abrir")}
                            </a>
                          )}
                          <Button
                            variant="outline"
                            onClick={() =>
                              setEditor({ resource: "pages", value: { ...p } })
                            }
                          >
                            {t("Editar")}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => remove("pages", p.id)}
                          >
                            {t("Eliminar")}
                          </Button>
                        </div>
                      </div>
                    </Panel>
                  ))
                ) : (
                  <Nothing
                    description={t(
                      "Elige un proyecto o sus grupos y excluye los monitores internos."
                    )}
                  />
                )}
              </>
            )}
            {section === "maintenance" && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setEditor({ resource: "maintenance" })}
                  >
                    {t("Programar mantenimiento")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      globalMaintenance.length
                        ? void endMaintenance(globalMaintenance)
                        : void mutate("maintenance", "POST", {
                            scope: "global",
                            title: t("Mantenimiento global"),
                            target_id: null,
                            ends_at: null,
                            starts_at: Math.floor(Date.now() / 1000)
                          }).catch(() => undefined)
                    }
                  >
                    {globalMaintenance.length
                      ? t("Finalizar mantenimiento global")
                      : t("Activar mantenimiento global")}
                  </Button>
                </div>
                {data.maintenance.length ? (
                  data.maintenance.map((w) => (
                    <Panel
                      key={w.id}
                      title={w.title}
                      description={`${date(w.starts_at)} → ${w.ends_at === null ? t("Hasta finalizar manualmente") : date(w.ends_at)}`}
                    >
                      <div className="flex flex-wrap gap-2">
                        <span>
                          {w.scope === "global"
                            ? t("Todos los monitores")
                            : w.scope === "project"
                              ? data.projects.find((p) => p.id === w.target_id)
                                  ?.name
                              : w.scope === "group"
                                ? data.groups.find((g) => g.id === w.target_id)
                                    ?.name
                                : data.monitors.find(
                                    (m) => m.id === w.target_id
                                  )?.name}
                        </span>
                        {w.starts_at <= now &&
                          (w.ends_at === null || w.ends_at > now) && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => void endMaintenance([w])}
                            >
                              {t("Finalizar mantenimiento")}
                            </Button>
                          )}
                        <Button
                          variant="outline"
                          onClick={() =>
                            setEditor({
                              resource: "maintenance",
                              value: { ...w }
                            })
                          }
                        >
                          {t("Editar")}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => remove("maintenance", w.id)}
                        >
                          {t("Eliminar")}
                        </Button>
                      </div>
                    </Panel>
                  ))
                ) : (
                  <Nothing
                    description={t(
                      "Las ventanas evitan alertas durante tus despliegues."
                    )}
                  />
                )}
              </>
            )}
          </>
        )}
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t("¿Eliminar este registro?")}
          description={t(
            "Esta acción no se puede deshacer. Se eliminarán los datos asociados a este registro."
          )}
          action={t("Eliminar")}
          destructive
          onConfirm={async () => {
            if (deleteTarget)
              await mutate(
                `${deleteTarget.resource}/${deleteTarget.id}`,
                "DELETE"
              );
          }}
        />
      </main>
    </div>
  );
}
