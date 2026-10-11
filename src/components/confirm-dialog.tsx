import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Notice } from "./common";
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
  destructive = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function change(value: boolean) {
    if (!busy) {
      setError("");
      onOpenChange(value);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No fue posible completar la operación."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Notice message={error} destructive />
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => change(false)}
          >
            Cancelar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Procesando…" : action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
