import { useLocale } from "../lib/locale";
import { Settings } from "../components/settings";
import { LocaleProvider } from "../lib/locale";
import { Overview } from "../components/overview";
import { ConfirmDialog } from "../components/confirm-dialog";
import { useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  Folder,
  Globe,
  Moon,
  Sun,
  Wrench,
  RefreshCw,
  Plus,
  ArrowLeft,
  Settings as SettingsIcon
} from "lucide-react";
import { api, useRefresh, type Snapshot } from "../lib/api";
import type { SafeMonitor } from "../shared/types";
import { cn } from "../lib/utils";
import { Notice, Nothing, Panel, StatusBadge } from "../components/common";
import { MonitorForm } from "../components/monitor-form";
import { ResourceForm, type Resource } from "../components/resource-form";
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
  const snapshot = useRefresh<Snapshot>("admin/snapshot");
  return (
    <LocaleProvider language={snapshot.data?.settings.general.language ?? "es"}>
      <DashboardView theme={theme} toggleTheme={toggleTheme} {...snapshot} />
    </LocaleProvider>
  );
}
function DashboardView({
  data,
  error,
  refresh,
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
  data: Snapshot | null;
  error: string;
  refresh: () => Promise<void>;
}) {
  const { t, date } = useLocale();
  const { section = "overview", id } = useParams(),
    navigate = useNavigate();
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<{
      resource: string;
      id: string;
    } | null>(null);
  const [filter, setFilter] = useState(""),
    [project, setProject] = useState(""),
    [group, setGroup] = useState("");
  async function mutate(path: string, method: string, payload?: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ token?: string }>(
        `admin/${path}`,
        method,
        payload
      );
      if (result.token)
        setNotice(
          t(
            "Guardá este token de heartbeat; no se volverá a mostrar: {token}",
            { token: result.token }
          )
        );
      await refresh();
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
  const selected = data?.monitors.find((m) => m.id === id);
  const visible =
    data?.monitors.filter(
      (m) =>
        (!project || m.project_id === project) &&
        (!group || m.group_id === group) &&
        m.name.toLowerCase().includes(filter.toLowerCase())
    ) ?? [];
  const titles: Record<string, string> = {
    overview: t("Resumen"),
    monitors: t("Monitores"),
    projects: t("Proyectos y grupos"),
    pages: t("Páginas públicas"),
    maintenance: t("Mantenimiento"),
    settings: t("Ajustes")
  };
  const nav = [
    { to: "overview", label: t("Resumen"), icon: Activity },
    { to: "monitors", label: t("Monitores"), icon: Activity },
    { to: "projects", label: t("Proyectos y grupos"), icon: Folder },
    { to: "pages", label: t("Páginas públicas"), icon: Globe },
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
            value={section}
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
              aria-label={t("Actualizar")}
              onClick={() => void refresh()}
            >
              <RefreshCw />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Cambiar tema")}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
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
            {section === "settings" && (
              <Settings data={data} onChange={refresh} />
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
                        {t("{count} minutos", {
                          count: selected.interval_seconds / 60
                        })}
                      </dd>
                    </div>
                  </dl>
                </Panel>
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
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <ChoiceSelect
                      aria-label={t("Filtrar por proyecto")}
                      value={project}
                      onValueChange={(value) => {
                        setProject(value);
                        setGroup("");
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
                      onValueChange={(value) => setGroup(value)}
                      options={[
                        { value: "", label: t("Todos los grupos") },
                        ...data.groups
                          .filter((g) => !project || g.project_id === project)
                          .map((g) => ({ value: g.id, label: g.name }))
                      ]}
                    />
                  </div>
                  <Button
                    className="self-start"
                    disabled={
                      !data.projects.length || data.monitors.length >= 100
                    }
                    onClick={() => setEditor({ resource: "monitors" })}
                  >
                    <Plus data-icon="inline-start" />
                    {t("Nuevo monitor")}
                  </Button>
                </div>
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
                          <TableHead>{t("Nombre")}</TableHead>
                          <TableHead>{t("Proyecto / grupo")}</TableHead>
                          <TableHead>{t("Estado")}</TableHead>
                          <TableHead>{t("Latencia")}</TableHead>
                          <TableHead>{t("Última comprobación")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((m) => (
                          <TableRow key={m.id}>
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
                        data.projects.length
                          ? t("Agregá tu primer monitor.")
                          : t("Creá primero un proyecto en Proyectos y grupos.")
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
                      "Creá proyectos para organizar tus monitores."
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
                      "Elegí un proyecto o sus grupos y excluí los monitores internos."
                    )}
                  />
                )}
              </>
            )}
            {section === "maintenance" && (
              <>
                <Button
                  className="self-start"
                  disabled={!data.projects.length}
                  onClick={() => setEditor({ resource: "maintenance" })}
                >
                  {t("Programar mantenimiento")}
                </Button>
                {data.maintenance.length ? (
                  data.maintenance.map((w) => (
                    <Panel
                      key={w.id}
                      title={w.title}
                      description={`${date(w.starts_at)} → ${date(w.ends_at)}`}
                    >
                      <div className="flex flex-wrap gap-2">
                        <span>
                          {w.scope === "project"
                            ? data.projects.find((p) => p.id === w.target_id)
                                ?.name
                            : w.scope === "group"
                              ? data.groups.find((g) => g.id === w.target_id)
                                  ?.name
                              : data.monitors.find((m) => m.id === w.target_id)
                                  ?.name}
                        </span>
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
