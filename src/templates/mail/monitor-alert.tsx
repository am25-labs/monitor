import { EmailLayout } from "./_components/email-layout";
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
}

export function MonitorAlertEmail({
  title,
  subject,
  monitor,
  fields,
  url,
  fontUrl,
  recovered
}: AlertDetails) {
  return (
    <EmailLayout
      subject={subject}
      preview={`${title}: ${monitor}`}
      fontUrl={fontUrl}
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailText>
        {recovered
          ? "El servicio volvió a responder correctamente y el incidente se cerró."
          : "El monitor alcanzó su umbral de fallos y se abrió un incidente."}
      </EmailText>
      <EmailDetails>
        <EmailField label="Monitor">
          <strong>{monitor}</strong>
        </EmailField>
        {fields.map(({ label, value }) => (
          <EmailField key={label} label={label}>
            {value}
          </EmailField>
        ))}
      </EmailDetails>
      <EmailButton href={url}>Ver monitor</EmailButton>
      <EmailText>
        Esta alerta es personal. No se enviaron notificaciones a tus clientes.
      </EmailText>
    </EmailLayout>
  );
}
