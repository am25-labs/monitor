import { useLocale } from "../lib/locale";
import {
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ExternalLink, Mail, Send, ShieldCheck } from "lucide-react";
import { api, type Snapshot } from "../lib/api";
import { product } from "../shared/product";
import type {
  SafeNotificationConfig,
  NotificationConfig,
  GeneralSettings,
} from "../shared/settings";
import { ChoiceSelect } from "./choice-select";
import { FormField, Notice, Panel } from "./common";
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
      <FormField id="notification-stream" label="Message Stream">
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
            ? t("Dejalo vacío para conservar el token existente.")
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
            ? t("Dejalo vacío para conservar el token existente.")
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
function Notifications({
  initial,
  onChange,
}: {
  initial: SafeNotificationConfig;
  onChange: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [saved, setSaved] = useState(initial);
  const [channel, setChannel] = useState(initial.channel);
  const [email, setEmail] = useState({
    to: initial.email.to,
    from: initial.email.from,
    stream: initial.email.stream,
    token: "",
  });
  const [telegram, setTelegram] = useState({
    chatId: initial.telegram.chatId,
    token: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<SafeNotificationConfig>(
        "admin/settings/notifications",
        "PUT",
        { channel, email, telegram },
      );
      setSaved(result);
      setEmail((current) => ({ ...current, token: "" }));
      setTelegram((current) => ({ ...current, token: "" }));
      setNotice(
        t("Configuración guardada. Las alertas usarán el canal seleccionado."),
      );
      await onChange();
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
    <Panel
      title={t("Notificaciones")}
      description={t(
        "Un canal para tus alertas personales de caída y recuperación.",
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Notice message={error} destructive />
        <Notice message={notice} />
        <FieldGroup>
          <FormField
            id="notification-channel"
            label={t("Canal de notificaciones")}
          >
            <ChoiceSelect
              id="notification-channel"
              value={channel}
              disabled={busy}
              onValueChange={(value) => setChannel(value as typeof channel)}
              options={[
                { value: "email", label: t("Correo · Postmark") },
                { value: "telegram", label: "Telegram" },
              ]}
            />
            <FieldDescription>
              {t(
                "Las alertas se envían únicamente al destinatario configurado aquí.",
              )}
            </FieldDescription>
          </FormField>
          {channel === "email" ? (
            <EmailFields
              value={email}
              setValue={setEmail}
              busy={busy}
              hasToken={saved.email.hasToken}
            />
          ) : (
            <TelegramFields
              value={telegram}
              setValue={setTelegram}
              busy={busy}
              hasToken={saved.telegram.hasToken}
            />
          )}
        </FieldGroup>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            {t("Tokens cifrados en D1.")}
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? t("Guardando…") : t("Guardar cambios")}
          </Button>
        </div>
        {!saved.configured && (
          <p className="text-sm text-muted-foreground">
            {t("Configura y guarda un canal para comenzar a recibir alertas.")}
          </p>
        )}
      </form>
    </Panel>
  );
}

function General({
  initial,
  onChange,
}: {
  initial: GeneralSettings;
  onChange: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [language, setLanguage] = useState(initial.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api<GeneralSettings>("admin/settings/general", "PUT", { language });
      await onChange();
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
    <Panel
      title={t("General")}
      description={t(
        "Preferencias del dashboard. Cada página pública tiene su propio idioma.",
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
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
        <Notice message={error} destructive />
        {saved && <Notice message={t("Idioma guardado.")} />}
        <Button type="submit" disabled={busy} className="self-end">
          {busy ? t("Guardando…") : t("Guardar cambios")}
        </Button>
      </form>
    </Panel>
  );
}

export function Settings({
  data,
  onChange,
}: {
  data: Snapshot;
  onChange: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <div className="flex max-w-3xl flex-col gap-6 text-sm [&_[data-slot=card-title]]:text-sm">
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
          <p className="text-muted-foreground">
            {t("Creado por")} {product.author}
          </p>
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
        <TabsList aria-label={t("Ajustes")} className="h-8 shrink-0 self-start">
          <TabsTrigger value="about">{t("Acerca de")}</TabsTrigger>
          <TabsTrigger value="general">{t("General")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("Notificaciones")}</TabsTrigger>
        </TabsList>
        <TabsContent value="about" className="flex flex-col gap-6">
          <Panel title={t("Licencia y autoría")}>
            <div className="flex flex-col gap-4 text-sm">
              <p>
                {product.name} {t("está disponible bajo")}{" "}
                <a
                  href={`${product.repository}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  Apache License 2.0
                </a>
                .
              </p>
              <p className="text-muted-foreground">
                {t(
                  "La licencia permite usar, modificar y distribuir el código bajo sus condiciones. Consulta el texto completo en el repositorio. Las dependencias conservan sus propias licencias.",
                )}
              </p>
              <Separator />
              <p>
                {t("Autoría:")} {product.author}.
              </p>
              <p className="text-muted-foreground">
                © {new Date().getFullYear()} {product.copyright}
              </p>
            </div>
          </Panel>
          <Panel title={t("Datos y privacidad")}>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                {t(
                  "El historial individual se conserva seis meses calendario; los agregados diarios y los incidentes, 365 días. Las páginas públicas solo muestran los monitores seleccionados y datos sanitizados.",
                )}
              </p>
              <p>
                {t(
                  "Las alertas comparten los detalles del incidente con Postmark o Telegram, según el canal que configures. El acceso privado se administra mediante Cloudflare Access.",
                )}
              </p>
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="general">
          <General initial={data.settings.general} onChange={onChange} />
        </TabsContent>
        <TabsContent value="notifications">
          <Notifications
            initial={data.settings.notifications}
            onChange={onChange}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
