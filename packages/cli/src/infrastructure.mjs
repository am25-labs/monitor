import { CloudflareError } from "./cloudflare.mjs";
import { requireValue } from "./messages.mjs";
import { privatePaths } from "./runtime.mjs";

export function appDestinations(app) {
  if (app.destinations?.length) return app.destinations;
  const domains = app.self_hosted_domains?.length ? app.self_hosted_domains : [app.domain];
  return domains.filter(Boolean).map((uri) => ({ type: "public", uri }));
}

function hostMatches(pattern, hostname) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}

export function appOverlaps(app, state) {
  return appDestinations(app).some((destination) => {
    if (destination.type === "all_workers") return true;
    if (destination.type === "worker") return destination.worker_id === state.workerId || destination.worker_id === state.name;
    return destination.type === "public" && hostMatches(destination.uri.split("/")[0], state.hostname);
  });
}

export function validateAccess(app, policies, state, email) {
  const expected = privatePaths.map((path) => `${state.hostname}${path}`).sort();
  const actual = appDestinations(app).map((destination) => destination.type === "public" ? destination.uri : destination.type).sort();
  requireValue(app.type === "self_hosted" && JSON.stringify(actual) === JSON.stringify(expected), "Access debe proteger exactamente las cuatro rutas privadas de Monitor.", "Access must protect exactly Monitor's four private paths.");
  requireValue(app.aud === state.resources.access.aud && app.allowed_idps?.length === 1 && app.allowed_idps[0] === state.resources.identityProvider,
    "La audiencia o el proveedor de Access no coincide con la instalación.", "Access audience or identity provider does not match the installation.");
  requireValue(policies.length === 1 && policies[0].decision === "allow" && policies[0].include?.length === 1
    && policies[0].include[0].email?.email?.toLowerCase() === email.toLowerCase()
    && !policies[0].exclude?.length && !policies[0].require?.length,
    "La política de Access debe autorizar únicamente el correo del propietario.", "Access policy must allow only the owner's email.");
}

export async function preflight(cf, state) {
  const prefix = (suffix) => cf.account(state, suffix);
  const [zone, databases, queues, scripts, domains, apps, providers, records] = await Promise.all([
    cf.get(`/zones/${encodeURIComponent(state.zoneId)}`),
    cf.list(prefix("/d1/database")), cf.list(prefix("/queues")), cf.list(prefix("/workers/scripts")),
    cf.list(prefix("/workers/domains")), cf.list(prefix("/access/apps")), cf.list(prefix("/access/identity_providers")),
    cf.list(`/zones/${encodeURIComponent(state.zoneId)}/dns_records?name=${encodeURIComponent(state.hostname)}`)
  ]);
  requireValue(zone.status === "active" && zone.account.id === state.accountId && (state.hostname === zone.name || state.hostname.endsWith(`.${zone.name}`)),
    "El dominio debe pertenecer a una zona activa de la cuenta seleccionada.", "The hostname must belong to an active zone in the selected account.");
  requireValue(!databases.some((db) => db.name === state.databaseName && db.uuid !== state.resources.database?.id), "Ya existe otra base con ese nombre.", "Another database already uses this name.");
  requireValue(!queues.some((queue) => queue.queue_name === state.queueName && queue.queue_id !== state.resources.queue?.id), "Ya existe otra cola con ese nombre.", "Another queue already uses this name.");
  requireValue(!scripts.some((script) => script.id === state.name) || Boolean(state.deployedVersion || state.operation?.publishing), "Ya existe otro Worker con ese nombre.", "Another Worker already uses this name.");
  requireValue(!domains.some((domain) => domain.hostname === state.hostname && domain.service !== state.name), "El hostname pertenece a otro Worker.", "The hostname belongs to another Worker.");
  const ownDomain = domains.some((domain) => domain.hostname === state.hostname && domain.service === state.name && (state.deployedVersion || state.operation?.publishing));
  requireValue(!records.length || ownDomain, "El hostname ya tiene registros DNS. Resolvé el conflicto antes de continuar.", "The hostname already has DNS records. Resolve the conflict before continuing.");
  requireValue(!apps.some((app) => app.id !== state.resources.access?.id && appOverlaps(app, state)), "Otra aplicación de Access se superpone con Monitor. Revisá sus destinos antes de continuar.", "Another Access application overlaps Monitor. Review its destinations before continuing.");
  return { providers, domains };
}

export async function zeroTrust(cf, state, ui) {
  while (true) {
    const org = await cf.get(cf.account(state, "/access/organizations"), { allowMissing: true });
    if (org?.auth_domain) {
      requireValue(/^[a-z\d-]+\.cloudflareaccess\.com$/i.test(org.auth_domain), "Dominio de equipo inesperado.", "Unexpected team domain.");
      return `https://${org.auth_domain}`;
    }
    ui.log("Completá el alta de Zero Trust: nombre de equipo, plan y datos que solicite Cloudflare. La CLI no contrata servicios.", "Complete Zero Trust onboarding: team name, plan and details requested by Cloudflare. The CLI does not subscribe to services.");
    ui.log("https://one.dash.cloudflare.com/");
    await ui.confirm("¿Ya completaste el alta y querés volver a verificar?", "Have you completed onboarding and want to check again?");
  }
}

async function createResource(store, state, kind, create, normalize) {
  if (state.resources[kind]) return;
  requireValue(!state.pending, "Una creación quedó sin respuesta confirmada. Revisá los recursos en Cloudflare antes de continuar; no se repetirá automáticamente.", "A creation has an unconfirmed outcome. Review Cloudflare resources before continuing; it will not be repeated automatically.");
  state.pending = { kind, startedAt: new Date().toISOString() };
  await store.save(state);
  try {
    const result = await create();
    const resource = normalize(result);
    requireValue(resource && (typeof resource === "string" || resource.id), "Cloudflare no devolvió el identificador del recurso creado. Revisá el diagnóstico.", "Cloudflare did not return the created resource identifier. Review diagnostics.");
    state.resources[kind] = resource;
    delete state.pending;
    await store.save(state);
  } catch (error) {
    if (error instanceof CloudflareError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      delete state.pending;
      await store.save(state);
    }
    throw error;
  }
}

export async function provision(cf, store, state, providers, secrets) {
  const prefix = (suffix) => cf.account(state, suffix);
  const otp = providers.find((provider) => provider.type === "onetimepin");
  if (!state.resources.identityProvider && otp) {
    state.resources.identityProvider = otp.id;
    await store.save(state);
  }
  await createResource(store, state, "database", () => cf.post(prefix("/d1/database"), { name: state.databaseName }),
    (db) => ({ id: db.uuid, name: db.name }));
  await createResource(store, state, "queue", () => cf.post(prefix("/queues"), { queue_name: state.queueName }),
    (queue) => ({ id: queue.queue_id, name: queue.queue_name }));
  await createResource(store, state, "identityProvider", () => cf.post(prefix("/access/identity_providers"), { name: "Monitor One-time PIN", type: "onetimepin", config: {} }), (provider) => provider.id);
  await createResource(store, state, "access", () => cf.post(prefix("/access/apps"), {
    name: `${state.name} dashboard`, type: "self_hosted", domain: `${state.hostname}/app`,
    destinations: privatePaths.map((path) => ({ type: "public", uri: `${state.hostname}${path}` })),
    allowed_idps: [state.resources.identityProvider], auto_redirect_to_identity: true, session_duration: "24h",
    policies: [{ name: "Monitor owner", decision: "allow", include: [{ email: { email: secrets.ACCESS_EMAIL } }] }]
  }), (app) => ({ id: app.id, aud: app.aud }));
  requireValue(Boolean(state.resources.access.aud), "Falta la audiencia de Access.", "Access audience is missing.");
}

export async function inspectResources(cf, state, secrets, { worker = true } = {}) {
  const prefix = (suffix) => cf.account(state, suffix);
  const [database, queue, app, policies, provider, organization] = await Promise.all([
    cf.get(prefix(`/d1/database/${encodeURIComponent(state.resources.database.id)}`)),
    cf.get(prefix(`/queues/${encodeURIComponent(state.resources.queue.id)}`)),
    cf.get(prefix(`/access/apps/${encodeURIComponent(state.resources.access.id)}`)),
    cf.list(prefix(`/access/apps/${encodeURIComponent(state.resources.access.id)}/policies`)),
    cf.get(prefix(`/access/identity_providers/${encodeURIComponent(state.resources.identityProvider)}`)),
    cf.get(prefix("/access/organizations"))
  ]);
  requireValue(database.uuid === state.resources.database.id && database.name === state.resources.database.name && queue.queue_id === state.resources.queue.id && queue.queue_name === state.resources.queue.name,
    "Los recursos remotos no coinciden con la instalación.", "Remote resources do not match the installation.");
  validateAccess(app, policies, state, secrets.ACCESS_EMAIL);
  requireValue(provider.type === "onetimepin" && `https://${organization.auth_domain}` === state.teamDomain, "El proveedor o equipo de Zero Trust cambió.", "Zero Trust provider or team changed.");
  const apps = await cf.list(prefix("/access/apps"));
  requireValue(!apps.some((item) => item.id !== app.id && appOverlaps(item, state)), "Hay otra aplicación de Access superpuesta.", "Another Access application overlaps this installation.");
  if (!worker) return null;
  const settings = await cf.get(prefix(`/workers/scripts/${encodeURIComponent(state.name)}/settings`));
  const bindings = settings.bindings ?? [];
  const allowedBindings = new Set(["ASSETS", "DB", "CHECKS", "SCHEDULER", "CHECK_RUNNERS", "ENVIRONMENT", "APP_ORIGIN", "ACCESS_TEAM_DOMAIN", "ACCESS_AUDIENCES", "MONITOR_VERSION", "MONITOR_SOURCE_SHA", "CONFIG_KEY", "ACCESS_EMAIL"]);
  const additional = bindings.filter((binding) => !allowedBindings.has(binding.name)
    && !(binding.name === "POSTMARK_TOKEN" && binding.type === "secret_text"));
  const names = additional.map((binding) => `${binding.name} (${binding.type})`).join(", ");
  requireValue(additional.length === 0, `El Worker tiene bindings adicionales que requieren conciliación manual: ${names}.`, `Additional Worker bindings require manual reconciliation: ${names}.`);
  requireValue(bindings.some((binding) => binding.name === "DB" && binding.type === "d1" && (binding.database_id ?? binding.id) === state.resources.database.id), "El Worker usa otra base de datos.", "The Worker uses another database.");
  requireValue(bindings.some((binding) => binding.name === "CHECKS" && binding.type === "queue" && binding.queue_name === state.resources.queue.name), "El Worker usa otra cola.", "The Worker uses another queue.");
  const expected = { ENVIRONMENT: "production", APP_ORIGIN: `https://${state.hostname}`, ACCESS_TEAM_DOMAIN: state.teamDomain, ACCESS_AUDIENCES: state.resources.access.aud };
  for (const [name, value] of Object.entries(expected)) requireValue(bindings.some((binding) => binding.name === name && binding.text === value), "La configuración remota del Worker cambió.", "Remote Worker configuration changed.");
  for (const name of ["CONFIG_KEY", "ACCESS_EMAIL"]) requireValue(bindings.some((binding) => binding.name === name && binding.type === "secret_text"), "Faltan secretos remotos de Monitor.", "Monitor remote secrets are missing.");
  const namespaces = Object.fromEntries(["SCHEDULER", "CHECK_RUNNERS"].map((name) => {
    const binding = bindings.find((item) => item.name === name && item.type === "durable_object_namespace");
    requireValue(Boolean(binding?.namespace_id), "Falta un namespace de Durable Objects.", "A Durable Objects namespace is missing.");
    requireValue(!state.resources.namespaces?.[name] || state.resources.namespaces[name] === binding.namespace_id, "Un namespace de Durable Objects cambió. Se detuvo la operación.", "A Durable Objects namespace changed. Operation stopped.");
    return [name, binding.namespace_id];
  }));
  return { settings, namespaces };
}
