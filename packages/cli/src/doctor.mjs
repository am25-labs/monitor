import { join } from "node:path";
import { inspectResources } from "./infrastructure.mjs";
import { remoteRelease } from "./operations.mjs";
import { verifyRuntime } from "./runtime.mjs";
import { requireValue } from "./messages.mjs";

export async function doctor({ store, state, cf, ui, fetcher = fetch }) {
  const results = [];
  const check = async (es, en, action) => {
    try {
      const detail = await action();
      ui.log(`✓ ${es}${detail ? `: ${detail}` : ""}`, `✓ ${en}${detail ? `: ${detail}` : ""}`);
      results.push({ name: en, ok: true });
    } catch (error) {
      ui.log(`✗ ${es}: ${error.es ?? "No se pudo verificar."}`, `✗ ${en}: ${error.en ?? "Could not verify."}`);
      results.push({ name: en, ok: false });
    }
  };
  await check("Estado de la instalación", "Installation state", async () => {
    requireValue(!state.pending && !state.operation && state.phase === "ready", "Hay una operación incompleta. Revisá installation.json y reanudá el mismo comando. Si una creación quedó sin respuesta, contrastá sus recursos en Cloudflare antes de corregir el registro.", "An operation is incomplete. Review installation.json and resume the same command. If a creation outcome is unknown, reconcile its resources in Cloudflare before correcting the record.");
  });
  let manifest;
  await check("Integridad de la versión local", "Local release integrity", async () => {
    manifest = await verifyRuntime(join(store.directory, "releases", state.adoption?.target ?? state.deployedVersion ?? state.targetVersion ?? "unavailable"));
  });
  await check("Recursos, Access y versión remota", "Resources, Access and remote version", async () => {
    const secrets = await store.secrets();
    const remote = await inspectResources(cf, state, secrets);
    const actual = remoteRelease(remote.settings);
    requireValue(actual.version === state.deployedVersion && actual.sourceSha === state.sourceSha, "La versión remota no coincide.", "Remote version does not match.");
    const domains = await cf.list(cf.account(state, "/workers/domains"));
    requireValue(domains.some((domain) => domain.hostname === state.hostname && domain.service === state.name && domain.zone_id === state.zoneId), "El Custom Domain no coincide.", "Custom Domain does not match.");
    const response = await cf.get(cf.account(state, `/workers/scripts/${encodeURIComponent(state.name)}/schedules`));
    requireValue(Array.isArray(response?.schedules), "Cloudflare devolvió un formato de crons no reconocido.", "Cloudflare returned an unrecognized cron response.");
    requireValue(response.schedules.some((schedule) => schedule.cron === "* * * * *"), "Falta el cron por minuto.", "The per-minute cron is missing.");
  });
  await check("Migraciones de D1", "D1 migrations", async () => {
    requireValue(Boolean(manifest), "Primero recuperá el runtime local.", "Recover the local runtime first.");
    const rows = await cf.query(state, "SELECT name FROM d1_migrations ORDER BY name");
    const expected = Object.keys(manifest.files).filter((name) => name.startsWith("migrations/")).map((name) => name.slice("migrations/".length)).sort();
    requireValue(JSON.stringify(rows.map((row) => row.name).sort()) === JSON.stringify(expected), "Las migraciones remotas no coinciden con la versión instalada.", "Remote migrations do not match the installed version.");
  });
  await check("Actividad reciente del motor", "Recent engine activity", async () => {
    const [engine] = await cf.query(state, "SELECT last_finished FROM engine WHERE id=1");
    requireValue(engine?.last_finished && engine.last_finished >= Math.floor(Date.now() / 1000) - 300, "Todavía no se observó un ciclo reciente. Esperá unos minutos y repetí doctor.", "No recent cycle observed yet. Wait a few minutes and run doctor again.");
  });
  const request = (path) => fetcher(`https://${state.hostname}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  for (const path of ["/app", "/app/", "/api/v1/admin", "/api/v1/admin/projects"]) {
    await check(`Protección de ${path}`, `Protection of ${path}`, async () => {
      const response = await request(path);
      const location = response.headers.get("location");
      const login = location && new URL(location, `https://${state.hostname}`);
      const redirected = response.status >= 300 && response.status < 400 && login && (login.origin === state.teamDomain || login.hostname === state.hostname) && login.pathname.startsWith("/cdn-cgi/access/");
      requireValue(response.status === 401 || response.status === 403 || redirected, "La ruta privada no devolvió una respuesta de autenticación esperada.", "Private path did not return an expected authentication response.");
      await response.body?.cancel();
    });
  }
  for (const path of [`/api/v1/public/monitor-cli-${state.id}`, `/api/v1/heartbeats/${state.id}`]) {
    await check(`Acceso público de ${path.split("/")[3]}`, `Public access to ${path.split("/")[3]}`, async () => {
      const response = await request(path);
      requireValue(response.status === 404, "La ruta pública no devolvió el 404 esperado para este recurso inexistente.", "Public path did not return the expected 404 for this nonexistent resource.");
      await response.body?.cancel();
    });
  }
  ui.log("Pendiente de comprobación humana: iniciar sesión con el propietario y revisar una página de estado real. No se enviaron alertas ni heartbeats de prueba.", "Human verification pending: sign in as the owner and inspect a real status page. No alerts or test heartbeats were sent.");
  const valid = results.every((result) => result.ok);
  if (valid) ui.log("Diagnóstico automático completado correctamente.", "Automated diagnostics completed successfully.");
  else ui.log("Diagnóstico automático incompleto. Revisá las comprobaciones marcadas con ✗.", "Automated diagnostics incomplete. Review checks marked with ✗.");
  return valid;
}
