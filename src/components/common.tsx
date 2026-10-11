import type { ReactNode } from "react";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Field, FieldLabel } from "./ui/field";
import { cn } from "../lib/utils";
import type { Status } from "../shared/types";

export const statusLabels: Record<Status, string> = {
  pending: "Pendiente",
  up: "Operativo",
  down: "Caído",
  unknown: "Sin datos",
  paused: "Pausado",
  maintenance: "Mantenimiento"
};
export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "up" && "text-success",
        status === "down" && "text-destructive",
        status === "maintenance" && "text-warning"
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusLabels[status]}
    </Badge>
  );
}
export function Panel({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function Nothing({
  title = "Todavía no hay registros",
  description = "Agregá el primero para comenzar."
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
export function Notice({
  message,
  destructive = false
}: {
  message: string;
  destructive?: boolean;
}) {
  return message ? (
    <Alert variant={destructive ? "destructive" : "default"}>
      <AlertTitle>
        {destructive ? "No se pudo completar" : "Información"}
      </AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;
}
export function FormField({
  label,
  id,
  children
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
    </Field>
  );
}
