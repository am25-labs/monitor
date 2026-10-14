import { useLocale } from "../lib/locale";
import {
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ExternalLink, Mail, Send, ShieldCheck } from "lucide-react";
import { type Snapshot } from "../lib/api";
import { useMutation } from "../lib/mutations";
import { product } from "../shared/product";
import type {
  SafeNotificationConfig,
  NotificationConfig,
  GeneralSettings,
  NotificationChannel,
} from "../shared/settings";
import { ChoiceSelect } from "./choice-select";
import { AboutDialog } from "./about-dialog";
import { DataExport } from "./data-export";
import { DataRestore } from "./data-restore";
import { ConfirmDialog } from "./confirm-dialog";
import { FormField, Notice, Panel } from "./common";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FieldDescription, FieldGroup } from "./ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";

type ChannelFields<T> = {
  value: T;
  setValue: Dispatch<SetStateAction<T>>;
  busy: boolean;
  hasToken: boolean;
};
function EmailFields({
  value: email,
  setValue: setEmail,
  busy,
  hasToken,
}: ChannelFields<NotificationConfig["email"]>) {
  const { t } = useLocale();
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="size-4" />
        <p>{t("El envío de correo está integrado con Postmark.")}</p>
      </div>
      <FormField id="notification-to" label={t("Correo destinatario")}>
        <Input
          id="notification-to"
          type="email"
          required
          disabled={busy}
          value={email.to}
          onChange={(event) =>
            setEmail((current) => ({
              ...current,
              to: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField
        id="notification-from"
        label={t("Remitente verificado en Postmark")}
      >
        <Input
          id="notification-from"
          type="email"
          required
          disabled={busy}
          value={email.from}
          onChange={(event) =>
            setEmail((current) => ({
              ...current,
              from: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField
        id="notification-stream"
        label={t("Flujo de mensajes de Postmark")}
      >
        <Input
          id="notification-stream"
          required
          disabled={busy}
          value={email.stream}
          onChange={(event) =>
            setEmail((current) => ({
              ...current,
              stream: event.target.value,
            }))
          }
        />
        <FieldDescription>
          {t("Usa un stream transaccional; normalmente es outbound.")}
        </FieldDescription>
      </FormField>
      <FormField
        id="notification-postmark-token"
        label={t("Server API Token de Postmark")}
      >
        <Input
          id="notification-postmark-token"
          type="password"
          autoComplete="new-password"
          required={!hasToken}
          disabled={busy}
          value={email.token}
          placeholder={hasToken ? t("Token guardado") : t("Ingresa tu token")}
          onChange={(event) =>
            setEmail((current) => ({
              ...current,
              token: event.target.value,
            }))
          }
        />
        <FieldDescription>
          {hasToken
            ? t("Déjalo vacío para conservar el token existente.")
            : t("El token se guardará cifrado y no se volverá a mostrar.")}
        </FieldDescription>
      </FormField>
    </>
  );
}
function TelegramFields({
  value: telegram,
  setValue: setTelegram,
  busy,
  hasToken,
}: ChannelFields<NotificationConfig["telegram"]>) {
  const { t } = useLocale();
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Send className="size-4" />
        <p>{t("Recibe tus alertas mediante un bot de Telegram.")}</p>
      </div>
      <FormField id="notification-chat" label={t("Identificador del chat")}>
        <Input
          id="notification-chat"
          required
          disabled={busy}
          value={telegram.chatId}
          onChange={(event) =>
            setTelegram((current) => ({
              ...current,
              chatId: event.target.value,
            }))
          }
          placeholder="123456789"
        />
        <FieldDescription>
          {t(
            "Inicia una conversación con tu bot y usa el identificador numérico del chat destinatario.",
          )}
        </FieldDescription>
      </FormField>
      <FormField id="notification-telegram-token" label={t("Token del bot")}>
        <Input
          id="notification-telegram-token"
          type="password"
          autoComplete="new-password"
          required={!hasToken}
          disabled={busy}
          value={telegram.token}
          placeholder={
            hasToken ? t("Token guardado") : t("Token generado por BotFather")
          }
          onChange={(event) =>
            setTelegram((current) => ({
              ...current,
              token: event.target.value,
            }))
          }
        />
        <FieldDescription>
          {hasToken
            ? t("Déjalo vacío para conservar el token existente.")
            : t("El token se guardará cifrado y no se volverá a mostrar.")}
        </FieldDescription>
      </FormField>
      <a
        href="https://core.telegram.org/bots/tutorial#obtain-your-bot-token"
        target="_blank"
        rel="noreferrer"
        className="text-sm underline underline-offset-4"
      >
        {t("Cómo crear un bot de Telegram")}
      </a>
    </>
  );
}
type SecretRenderer = (
  id: string,
  label: string,
  value: string,
  hasValue: boolean,
  update: (value: string) => void,
  required?: boolean,
) => React.ReactNode;
function PushoverFields({
  value: pushover,
  setValue: setPushover,
  busy,
  saved,
  secret,
}: ChannelFields<NotificationConfig["pushover"]> & {
  saved: SafeNotificationConfig["pushover"];
  secret: SecretRenderer;
}) {
  const { t } = useLocale();
  return (
    <>
      <FieldDescription>
        {t(
          "Instala Pushover en tu teléfono y crea una aplicación para obtener las claves.",
        )}
      </FieldDescription>
      {secret(
        "pushover-token",
        "API Token de Pushover",
        pushover.token,
        saved.hasToken,
        (token) => setPushover((value) => ({ ...value, token })),
      )}
      {secret(
        "pushover-user",
        "User Key de Pushover",
        pushover.userKey,
        saved.hasUserKey,
        (userKey) => setPushover((value) => ({ ...value, userKey })),
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="pushover-emergency"
          checked={pushover.emergency}
          disabled={busy}
          onCheckedChange={(checked) =>
            setPushover((value) => ({
              ...value,
              emergency: checked === true,
            }))
          }
        />
        <Label htmlFor="pushover-emergency">
          {t("Repetir alertas de caída hasta confirmar")}
        </Label>
      </div>
      {pushover.emergency && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="pushover-retry" label={t("Repetir cada (segundos)")}>
            <Input
              id="pushover-retry"
              type="number"
              min={30}
              max={3600}
              required
              disabled={busy}
              value={pushover.retrySeconds}
              onChange={(event) =>
                setPushover((value) => ({
                  ...value,
                  retrySeconds: Number(event.target.value),
                }))
              }
            />
          </FormField>
          <FormField
            id="pushover-expire"
            label={t("Duración máxima (segundos)")}
          >
            <Input
              id="pushover-expire"
              type="number"
              min={60}
              max={10800}
              required
              disabled={busy}
              value={pushover.expireSeconds}
              onChange={(event) =>
                setPushover((value) => ({
                  ...value,
                  expireSeconds: Number(event.target.value),
                }))
              }
            />
          </FormField>
        </div>
      )}
      <FieldDescription>
        {t(
          "Pushover limita cada alerta a 50 repeticiones. La recuperación cancela las pendientes. En iPhone, habilita las alertas críticas en Pushover y en los permisos de iOS.",
        )}
      </FieldDescription>
      <a
        className="text-sm underline underline-offset-4"
        href="https://pushover.net/"
        target="_blank"
        rel="noreferrer"
      >
        {t("Configurar Pushover")}
      </a>
    </>
  );
}
function NtfyFields({
  value: ntfy,
  setValue: setNtfy,
  busy,
  saved,
  secret,
}: ChannelFields<NotificationConfig["ntfy"]> & {
  saved: SafeNotificationConfig["ntfy"];
  secret: SecretRenderer;
}) {
  const { t } = useLocale();
  return (
    <>
      <FormField id="ntfy-server" label={t("Servidor de ntfy")}>
        <Input
          id="ntfy-server"
          type="url"
          required
          disabled={busy}
          value={ntfy.server}
          onChange={(event) =>
            setNtfy((value) => ({
              ...value,
              server: event.target.value,
            }))
          }
        />
      </FormField>
      {secret(
        "ntfy-topic",
        "Tema de ntfy",
        ntfy.topic,
        saved.hasTopic,
        (topic) => setNtfy((value) => ({ ...value, topic })),
      )}
      {secret(
        "ntfy-token",
        "Token de acceso (opcional)",
        ntfy.token,
        saved.hasToken,
        (token) => setNtfy((value) => ({ ...value, token })),
        false,
      )}
      <FieldDescription>
        {t(
          "Suscríbete al mismo tema en la app. En ntfy.sh gratuito, usa un nombre aleatorio: quien lo conozca puede leer y publicar mensajes. Se envía una alerta urgente por caída, sin repetición automática.",
        )}
      </FieldDescription>
      <a
        className="text-sm underline underline-offset-4"
        href="https://docs.ntfy.sh/subscribe/phone/"
        target="_blank"
        rel="noreferrer"
      >
        {t("Configurar ntfy")}
      </a>
    </>
  );
}
function Notifications({
  initial,
}: {
  initial: SafeNotificationConfig;
}) {
  const mutation = useMutation();
  const { t } = useLocale();
  const [saved, setSaved] = useState(initial);
  const [email, setEmail] = useState<NotificationConfig["email"]>({
    ...initial.email,
    token: "",
  });
  const [telegram, setTelegram] = useState<NotificationConfig["telegram"]>({
    ...initial.telegram,
    token: "",
  });
  const [pushover, setPushover] = useState<NotificationConfig["pushover"]>({
    ...initial.pushover,
    token: "",
    userKey: "",
  });
  const [ntfy, setNtfy] = useState<NotificationConfig["ntfy"]>({
    ...initial.ntfy,
    token: "",
    topic: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const values = { email, telegram, pushover, ntfy };
  function toggle(channel: NotificationChannel, enabled: boolean) {
    if (channel === "email") setEmail((value) => ({ ...value, enabled }));
    if (channel === "telegram") setTelegram((value) => ({ ...value, enabled }));
    if (channel === "pushover") setPushover((value) => ({ ...value, enabled }));
    if (channel === "ntfy") setNtfy((value) => ({ ...value, enabled }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mutation.mutate<SafeNotificationConfig>(
        "admin/settings/notifications",
        "PUT",
        values,
      );
      setSaved(result);
      setEmail((value) => ({ ...value, token: "" }));
      setTelegram((value) => ({ ...value, token: "" }));
      setPushover((value) => ({ ...value, token: "", userKey: "" }));
      setNtfy((value) => ({ ...value, token: "", topic: "" }));
      setNotice(
        t(
          "Configuración guardada. Las alertas usarán todos los canales activos.",
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("No se pudo guardar la configuración."),
      );
    } finally {
      setBusy(false);
    }
  }
  function secret(
    id: string,
    label: string,
    value: string,
    hasValue: boolean,
    update: (value: string) => void,
    required = true,
  ) {
    return (
      <FormField id={id} label={t(label)}>
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          disabled={busy}
          required={required && !hasValue}
          value={value}
          onChange={(event) => update(event.target.value)}
          placeholder={hasValue ? t("Valor guardado") : t("Ingresa el valor")}
        />
        <FieldDescription>
          {t(
            "Déjalo vacío para conservar el valor guardado. Se almacena cifrado.",
          )}
        </FieldDescription>
      </FormField>
    );
  }
  const names = {
    email: t("Correo · Postmark"),
    telegram: "Telegram",
    pushover: "Pushover",
    ntfy: "ntfy",
  };
  return (
    <Panel
      title={t("Hub de notificaciones")}
      description={t(
        "Activa uno o varios canales para tus alertas personales de caída y recuperación.",
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Notice message={error} destructive />
        <Notice message={notice} />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {(["email", "telegram", "pushover", "ntfy"] as const).map(
            (channel) => (
              <Card key={channel}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle>{names[channel]}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`enable-${channel}`}
                        checked={values[channel].enabled}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          toggle(channel, checked === true)
                        }
                      />
                      <Label htmlFor={`enable-${channel}`}>
                        {t("Activar")}
                      </Label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {!values[channel].enabled ? (
                    <p className="text-sm text-muted-foreground">
                      {t("Este canal está desactivado.")}
                    </p>
                  ) : (
                    <FieldGroup>
                      {channel === "email" && (
                        <EmailFields
                          value={email}
                          setValue={setEmail}
                          busy={busy}
                          hasToken={saved.email.hasToken}
                        />
                      )}
                      {channel === "telegram" && (
                        <TelegramFields
                          value={telegram}
                          setValue={setTelegram}
                          busy={busy}
                          hasToken={saved.telegram.hasToken}
                        />
                      )}
                      {channel === "pushover" && (
                        <PushoverFields
                          value={pushover}
                          setValue={setPushover}
                          busy={busy}
                          hasToken={saved.pushover.hasToken}
                          saved={saved.pushover}
                          secret={secret}
                        />
                      )}
                      {channel === "ntfy" && (
                        <NtfyFields
                          value={ntfy}
                          setValue={setNtfy}
                          busy={busy}
                          hasToken={saved.ntfy.hasToken}
                          saved={saved.ntfy}
                          secret={secret}
                        />
                      )}
                    </FieldGroup>
                  )}
                </CardContent>
              </Card>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            {t(
              "Credenciales cifradas en D1. Entregas y reintentos independientes por canal.",
            )}
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? t("Guardando…") : t("Guardar cambios")}
          </Button>
        </div>
        <FieldDescription>
          {t(
            "Si desactivas todos los canales, los nuevos eventos no enviarán alertas.",
          )}
        </FieldDescription>
      </form>
    </Panel>
  );
}

function General({
  initial,
  monitors,
}: {
  initial: GeneralSettings;
  monitors: Snapshot["monitors"];
}) {
  const mutation = useMutation();
  const { t } = useLocale();
  const [language, setLanguage] = useState(initial.language);
  const [testMode, setTestMode] = useState(initial.testMode);
  const [monitorId, setMonitorId] = useState("");
  const [deletion, setDeletion] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await mutation.mutate<GeneralSettings>("admin/settings/general", "PUT", {
        language,
        testMode,
      });
      setSaved(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("No se pudo guardar la configuración."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Panel
        title={t("General")}
        description={t(
          "Preferencias del dashboard. Cada página pública tiene su propio idioma.",
        )}
      >
        <FieldGroup>
          <FormField id="dashboard-language" label={t("Idioma del dashboard")}>
            <ChoiceSelect
              id="dashboard-language"
              value={language}
              disabled={busy}
              onValueChange={(value) => {
                setLanguage(value as GeneralSettings["language"]);
                setSaved(false);
              }}
              options={[
                { value: "es", label: t("Español") },
                { value: "en", label: t("Inglés") },
              ]}
            />
          </FormField>
        </FieldGroup>
      </Panel>
      <Card className="bg-destructive/5 ring-destructive/40 [&_[data-slot=card-title]]:text-destructive">
        <CardHeader>
          <CardTitle>{t("Modo de pruebas")}</CardTitle>
          <CardDescription>
            {t(
              "Elimina comprobaciones, estadísticas, incidentes y sus registros de notificación. Conserva los monitores y su configuración. Esta acción no se puede deshacer.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <FieldGroup>
            <FormField id="test-mode" label={t("Modo de pruebas")}>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="test-mode"
                  checked={testMode}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    setTestMode(checked === true);
                    setSaved(false);
                  }}
                />
                <Label htmlFor="test-mode">
                  {t("Habilitar herramientas para borrar el historial")}
                </Label>
              </div>
              <FieldDescription>
                {t(
                  "Guarda los cambios para habilitar estas herramientas. Al desactivar el modo, las opciones desaparecen.",
                )}
              </FieldDescription>
            </FormField>
          </FieldGroup>
          {initial.testMode && testMode && (
            <div className="flex flex-col gap-4">
              <Separator />
              <p className="font-medium">{t("Borrar historial de pruebas")}</p>
              <FormField id="history-monitor" label={t("Monitor")}>
                <ChoiceSelect
                  id="history-monitor"
                  value={monitorId}
                  onValueChange={setMonitorId}
                  placeholder={t("Selecciona un monitor")}
                  options={monitors.map((monitor) => ({
                    value: monitor.id,
                    label: monitor.name,
                  }))}
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!monitorId || busy}
                  onClick={() => setDeletion(monitorId)}
                >
                  {t("Borrar historial del monitor")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setDeletion(null)}
                >
                  {t("Borrar todo el historial")}
                </Button>
              </div>
              <ConfirmDialog
                open={deletion !== undefined}
                onOpenChange={(open) => {
                  if (!open) setDeletion(undefined);
                }}
                title={
                  deletion === null
                    ? t("Borrar todo el historial")
                    : t("Borrar historial de {name}", {
                        name:
                          monitors.find((monitor) => monitor.id === deletion)
                            ?.name ?? "",
                      })
                }
                description={t(
                  "Se eliminarán definitivamente las comprobaciones, estadísticas, incidentes y sus registros de notificación del alcance seleccionado. Los monitores volverán a pendiente hasta recibir una nueva comprobación. No se puede deshacer.",
                )}
                action={t("Borrar historial")}
                destructive
                onConfirm={async () => {
                  await mutation.mutate("admin/settings/history", "DELETE", {
                    monitorId: deletion,
                    confirmation: "DELETE_HISTORY",
                  });
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
      <Notice message={error} destructive />
      {saved && <Notice message={t("Configuración guardada.")} />}
      <Button type="submit" disabled={busy} className="self-end">
        {busy ? t("Guardando…") : t("Guardar cambios")}
      </Button>
    </form>
  );
}

export function Settings({
  data,
}: {
  data: Snapshot;
}) {
  const { t } = useLocale();
  return (
    <div className="flex w-full min-w-0 flex-col gap-6 text-sm [&_[data-slot=card-title]]:text-sm">
      <Card>
        <CardHeader>
          <CardTitle>{product.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {t("Versión")} {product.version}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <a
            href={product.repository}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-4"
          >
            {t("Repositorio del proyecto")}
            <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>
      <Tabs defaultValue="about" className="flex-col gap-6">
        <TabsList aria-label={t("Ajustes")} className="h-auto flex-wrap shrink-0 self-start">
          <TabsTrigger value="about">{t("Acerca de")}</TabsTrigger>
          <TabsTrigger value="general">{t("General")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("Notificaciones")}</TabsTrigger>
          <TabsTrigger value="export">{t("Exportar")}</TabsTrigger>
        </TabsList>
        <TabsContent value="about" className="grid gap-6 lg:grid-cols-2">
          <AboutDialog />
          <Panel title={t("Datos y privacidad")}>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                {t(
                  "El historial individual se conserva seis meses calendario; los agregados diarios y los incidentes, 365 días. Las páginas públicas solo muestran los monitores seleccionados y datos sanitizados.",
                )}
              </p>
              <p>
                {t(
                  "Las alertas comparten los detalles del incidente con los proveedores de los canales activos. El acceso privado se administra mediante Cloudflare Access.",
                )}
              </p>
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="general">
          <General
            initial={data.settings.general}
            monitors={data.monitors}
          />
        </TabsContent>
        <TabsContent value="notifications">
          <Notifications
            initial={data.settings.notifications}
          />
        </TabsContent>
        <TabsContent value="export" className="flex flex-col gap-6">
          <DataExport projects={data.projects} />
          <DataRestore />
        </TabsContent>
      </Tabs>
    </div>
  );
}
