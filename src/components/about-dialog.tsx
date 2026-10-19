import { Dialog } from "@base-ui/react/dialog";
import { Activity, BookOpen, FileText, Info, Scale, ShieldCheck, X } from "lucide-react";
import { useLocale } from "../lib/locale";
import software from "../lib/third-party-software.json";
import { product } from "../shared/product";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

const copyright = "© 2026 AM25";
const licenseUrl = `${product.repository}/blob/main/LICENSE`;
const buildSha = import.meta.env.VITE_GIT_SHA;
const commitSha = typeof buildSha === "string" && /^[a-f\d]{40}$/i.test(buildSha) ? buildSha : null;

function AboutLogo() {
  return <Activity className="size-28" aria-hidden="true" />;
}

function SoftwareNotices() {
  const { t } = useLocale();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="third-party-title">
      <h3 id="third-party-title" className="flex items-center gap-2 text-sm font-medium">
        <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        {t("Software de terceros")}
      </h3>
      <ul className="max-h-64 overflow-y-auto rounded-lg border">
        {software.dependencies.map((dependency) => (
          <li key={`${dependency.name}@${dependency.version}`} className="flex items-center justify-between gap-4 border-b px-4 py-3 text-xs last:border-b-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-all font-medium">{dependency.name}</span>
              <span className="text-muted-foreground">{dependency.version}</span>
            </div>
            <Badge variant="secondary" className="shrink-0">{dependency.license}</Badge>
          </li>
        ))}
      </ul>
      <Button variant="link" size="sm" className="h-auto self-start p-0" render={<a href="/assets/third-party-notices.txt" target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
        {t("Ver todas las licencias")}
      </Button>
    </section>
  );
}

export function AboutDialog() {
  const { t } = useLocale();
  return (
    <Card className="w-full text-center">
      <CardHeader className="flex flex-col items-center gap-5">
        <AboutLogo />
        <div className="flex flex-col gap-1">
          <CardTitle><h2 className="text-2xl">{product.name}</h2></CardTitle>
          <CardDescription>
            <a href="https://am25.work" target="_blank" rel="noopener" referrerPolicy="origin">{copyright}</a>
            <p className="mt-1 text-xs">{t("Versión")} {product.version}</p>
          </CardDescription>
        </div>
      </CardHeader>
      <CardFooter className="justify-center border-t-0 bg-card">
        <Dialog.Root>
          <Dialog.Trigger render={<Button />}>
            <Info data-icon="inline-start" />{t("Acerca de")}
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="monitor-about-backdrop" />
            <Dialog.Popup className="monitor-about-popup">
              <Dialog.Close render={<Button variant="ghost" size="icon-sm" />} className="absolute right-5 top-5" aria-label={t("Cerrar")}>
                <X />
              </Dialog.Close>
              <div className="flex flex-col items-center gap-2 border-b px-6 sm:px-8 pb-6 pt-8 text-center">
                <AboutLogo />
                <div className="mt-3 flex flex-col gap-2">
                  <Dialog.Title className="text-lg font-medium">{product.name}</Dialog.Title>
                  <Dialog.Description className="text-xs text-muted-foreground">
                    {t("Versión")} {product.version}
                    {commitSha && <> · <a href={`${product.repository}/releases/tag/${encodeURIComponent(product.version)}`} target="_blank" rel="noopener" title={commitSha} className="font-mono underline underline-offset-4">{commitSha.slice(0, 7)}</a></>}
                  </Dialog.Description>
                </div>
              </div>
              <div className="flex flex-col gap-6 px-6 sm:px-8 py-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card size="sm" className="border shadow-none ring-0">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("Derechos de autor")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{copyright}</p>
                      <p className="mt-3 text-xs text-muted-foreground">AM25, S.A.S. de C.V.</p>
                    </CardContent>
                  </Card>
                  <Card size="sm" className="border shadow-none ring-0">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("Licencia")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("Software de código abierto bajo")} <a href={licenseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Apache License 2.0</a>. {t("Puedes usar, modificar y distribuir el código conforme a sus condiciones. Las dependencias conservan sus propias licencias.")}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                <section className="flex flex-col gap-3" aria-labelledby="legal-notice-title">
                  <h3 id="legal-notice-title" className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-muted-foreground" aria-hidden="true" />{t("Aviso legal")}</h3>
                  <p className="rounded-lg bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
                    {t("AM25 Monitor se proporciona «tal cual», sin garantías de ningún tipo, expresas o implícitas. Su uso, modificación y distribución están sujetos a las condiciones de")} <a href={licenseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Apache License 2.0</a>. {t("Consulta el archivo")} <a href={`${product.repository}/blob/main/NOTICE`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">NOTICE</a> {t("para la atribución del proyecto.")}
                  </p>
                </section>
                <SoftwareNotices />
                <p className="text-center text-xs text-muted-foreground">
                  {t("Creado por")} <a href="https://alemartir.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{product.author}</a> · {t("Desarrollado por AM25")}
                </p>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </CardFooter>
    </Card>
  );
}
