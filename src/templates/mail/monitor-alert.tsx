import { EmailLayout } from "./_components/email-layout";
import { translate } from "../../shared/i18n";
import type { Language } from "../../shared/settings";
import {
  EmailButton,
  EmailDetails,
  EmailField,
  EmailHeading,
  EmailText
} from "./_components/email-content";

export interface AlertDetails {
  title: string;
  subject: string;
  monitor: string;
  fields: { label: string; value: string }[];
  url: string;
  fontUrl: string;
  recovered: boolean;
  language?: Language;
}

export function MonitorAlertEmail({
  title,
  subject,
  monitor,
  fields,
  url,
  fontUrl,
  recovered,
  language = "es"
}: AlertDetails) {
  const t = (text: string) => translate(language, text);
  return (
    <EmailLayout
      subject={subject}
      preview={`${title}: ${monitor}`}
      fontUrl={fontUrl}
      lang={language}
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailText>
        {t(recovered
          ? "El servicio volvió a responder correctamente y el incidente se cerró."
          : "El monitor alcanzó su umbral de fallos y se abrió un incidente.")}
      </EmailText>
      <EmailDetails>
        <EmailField label={t("Monitor")}>
          <strong>{monitor}</strong>
        </EmailField>
        {fields.map(({ label, value }) => (
          <EmailField key={label} label={label}>
            {value}
          </EmailField>
        ))}
      </EmailDetails>
      <EmailButton href={url}>{t("Ver monitor")}</EmailButton>
      <EmailText>
        {t("Esta alerta es personal. No se enviaron notificaciones a tus clientes.")}
      </EmailText>
    </EmailLayout>
  );
}
