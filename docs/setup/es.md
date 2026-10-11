# Configurar AM25 Monitor

[English](en.md) · [Presentación](../../README.md)

Esta guía instala AM25 Monitor en tu cuenta de Cloudflare usando GitHub Actions. Los ejemplos usan `monitor.example.com` y `owner@example.com`: reemplázalos por tus datos. No copies los identificadores de la instalación de AM25 que pueda contener la configuración del repositorio.

## 1. Preparar las cuentas y el dominio

Necesitas una cuenta de GitHub con Actions habilitado, una cuenta de Cloudflare con Workers, D1, Queues y Zero Trust disponibles, y un dominio cuya zona DNS esté activa en la misma cuenta de Cloudflare.

Elige un subdominio dedicado, por ejemplo `monitor.example.com`, que no sirva otra aplicación. No necesitas un VPS para alojar Monitor. Para los pasos locales, instala Git, Node.js 22.14 o superior y la versión de pnpm indicada en `package.json`.

Revisa los límites y el consumo antes de elegir tu plan. A un minuto, 100 monitores generan unas 144,000 comprobaciones diarias y unos 26 millones en seis meses, además de índices y agregados. Consulta los [límites de D1](https://developers.cloudflare.com/d1/platform/limits/) y los [precios de Queues](https://developers.cloudflare.com/queues/platform/pricing/).

## 2. Preparar tu repositorio y elegir una versión

Crea un fork o un repositorio propio con el código del proyecto, público o privado. Si quieres una versión específica, obtén el código de su etiqueta `vX.Y.Z` o descarga su archivo desde [Releases](https://github.com/am25-labs/monitor/releases). Prepara esa versión en una rama de tu repositorio antes de llevarla a `main`; no mezcles archivos de Releases distintos.

Clona tu repositorio y entra en su carpeta. Instala las dependencias:

```sh
pnpm install --frozen-lockfile
```

Realiza los ajustes siguientes en una rama de trabajo, por ejemplo `develop`. Habilita GitHub Actions en tu fork si está desactivado. Conserva `.github/workflows/deploy.yml`; no conectes también Workers Builds, porque desplegarías mediante dos pipelines.

## 3. Crear D1 y la cola

En Cloudflare, selecciona la cuenta donde alojarás la app y guarda su **Account ID**. Usa el ID de cuenta, no el ID de zona.

1. Abre **Storage & databases → D1** y crea una base, por ejemplo `my-monitor`. Guarda su nombre y **Database ID**.
2. Abre **Queues** y crea una cola, por ejemplo `my-monitor-checks`. Guarda su nombre.
3. Elige el nombre del Worker, por ejemplo `my-monitor`. El primer despliegue lo creará; no necesitas publicar un Worker vacío.

No crees tablas manualmente. El pipeline aplicará las migraciones de `migrations/`.

## 4. Proteger el dashboard con Access

En **Zero Trust**, completa la configuración de tu organización y guarda su dominio de equipo, por ejemplo `https://my-team.cloudflareaccess.com`.

1. En los proveedores de identidad, habilita **One-time PIN** para iniciar sesión con un código enviado al correo.
2. Abre **Access → Applications**, añade una aplicación **Self-hosted** y llámala `Monitor dashboard`.
3. Añade entradas del mismo hostname `monitor.example.com` para estas rutas:

   | Rutas protegidas |
   | --- |
   | `/app` |
   | `/app/*` |
   | `/api/v1/admin` |
   | `/api/v1/admin/*` |

4. Añade una política **Allow** con **Include → Emails** y el correo que usarás para entrar. Selecciona One-time PIN como método de acceso.
5. Guarda la aplicación y copia su **Application Audience (AUD) Tag**.

Usa una sola aplicación con esas entradas cuando sea posible, para compartir audiencia y sesión. Si utilizas aplicaciones separadas, copia todas sus audiencias, separadas por comas, en `ACCESS_AUDIENCES`.

No protejas el hostname completo ni uses una protección de todo el Worker: las páginas públicas y los heartbeats deben quedar accesibles sin sesión. Mantén fuera de las reglas `/status/*`, `/api/v1/public/*`, `/api/v1/heartbeats/*`, `/assets/*` y los endpoints de Cloudflare `/cdn-cgi/access/*`. Access verifica la política; el Worker también valida el JWT y admite un único correo configurado.

Consulta las guías oficiales de [aplicaciones de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) y [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

## 5. Configurar el Worker y el dominio

Edita `wrangler.jsonc` reemplazando los valores de la instalación original:

| Campo | Tu valor |
| --- | --- |
| `name` | Nombre elegido para el Worker |
| `account_id` | Tu Account ID |
| `routes[0].pattern` | `monitor.example.com`, sin protocolo ni ruta |
| `routes[0].custom_domain` | `true` |
| `vars.ENVIRONMENT` | `production` |
| `vars.ACCESS_TEAM_DOMAIN` | URL HTTPS del equipo, sin barra final |
| `vars.ACCESS_AUDIENCES` | AUD de Access; varias audiencias separadas por comas |
| `vars.APP_ORIGIN` | `https://monitor.example.com`, sin barra final |
| `d1_databases[0].database_name` | Nombre de tu base |
| `d1_databases[0].database_id` | Tu Database ID |
| `queues.producers[0].queue` | Nombre de tu cola |
| `queues.consumers[0].queue` | El mismo nombre de cola |

Conserva los bindings `DB`, `CHECKS` y `ASSETS`, `migrations_dir`, `run_worker_first`, el cron por minuto y los límites de consumidores. Mantén `workers_dev` y `preview_urls` en `false`. No añadas el correo a `vars`: `ACCESS_EMAIL` se suministra desde GitHub.

El Custom Domain se conecta durante el despliegue. Cloudflare administra su DNS y certificado; no necesitas apuntarlo a la IP de tu VPS. Si hay un CNAME existente en ese hostname, resuelve el conflicto antes de publicar, sin afectar registros de otros servicios. Consulta [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

El script actual lee este archivo como JSON: no añadas comentarios ni comas finales aunque su extensión sea `.jsonc`.

## 6. Crear el token de Cloudflare

En tu perfil de Cloudflare, abre **API Tokens → Create Token → Custom token**. Limita los recursos a tu cuenta y a la zona del dominio elegido. Configura permisos de edición para **Workers Scripts**, **D1** y **Queues** en la cuenta, y **Workers Routes** y **DNS** en la zona.

Guarda el token al crearlo. No uses la Global API Key. Este pipeline no crea políticas de Access: las configuras en el paso 4, sin concederle permisos para administrarlas.

## 7. Configurar GitHub Actions

En tu repositorio, abre **Settings → Secrets and variables → Actions**.

En **Secrets → New repository secret**, crea:

| Secreto | Valor |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | La misma cuenta de `wrangler.jsonc` |
| `CLOUDFLARE_API_TOKEN` | El token del paso anterior |
| `MONITOR_CONFIG_KEY` | Llave aleatoria de 32 bytes en hexadecimal: 64 caracteres |

Genera la llave en tu computadora:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarda una copia segura de esta llave. Cifra credenciales y configuración de notificaciones: reemplazarla sin migrar los datos hace que los valores existentes no puedan descifrarse.

En **Variables → New repository variable**, crea:

| Variable | Valor |
| --- | --- |
| `ACCESS_EMAIL` | El mismo correo autorizado en la política Allow de Access |

Las variables de GitHub no son secretos ni se enmascaran automáticamente. El correo queda fuera del código versionado; en Cloudflare se instala como Worker Secret `ACCESS_EMAIL`, junto con `CONFIG_KEY`. Si falta o no tiene formato válido, el despliegue se detiene antes de ejecutar migraciones.

No configures tokens de Postmark o Telegram en GitHub. Se guardan desde el dashboard, cifrados en D1. Los datos locales de `.dev.vars` no configuran producción.

## 8. Publicar por primera vez

Revisa los valores y lleva los cambios a `main` en tu repositorio. Ese push activa **Actions → Deploy production**. Los pushes a `develop`, los pull requests, las etiquetas y la creación de Releases no activan el despliegue.

El workflow instala con el lockfile, verifica TypeScript, ejecuta pruebas, compila la interfaz, aplica migraciones D1 y despliega Worker, assets y secretos. Un error detiene los pasos siguientes; un fallo de migración impide publicar el Worker. Los despliegues se ejecutan en serie.

Espera a que Actions termine correctamente. En Cloudflare, comprueba que tu Worker tiene el Custom Domain, el cron, la base y la cola asociados. Abre `https://monitor.example.com/app/`, inicia sesión con el correo autorizado y confirma que el overview muestra una ejecución reciente del motor.

## 9. Activar las notificaciones

Abre **Ajustes → Notificaciones** y guarda un canal global:

- **Correo:** crea un servidor en Postmark, verifica el remitente o su dominio y copia su **Server API Token**. Configura token, destinatario, remitente verificado y stream transaccional (habitualmente `outbound`). El destinatario puede ser diferente del correo de Access.
- **Telegram:** crea un bot con BotFather, copia su token e inicia una conversación con el bot. Obtén el ID numérico de tu chat personal y configura token e ID. Consulta el [tutorial de Telegram](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).

Las alertas son personales y se envían por apertura y recuperación, sin suscripciones de clientes. Hasta guardar un canal, no se entregan notificaciones; los intentos pendientes siguen la política de reintentos y pueden terminar en fallo. Revisa sus estados en el overview.

En **Ajustes → General**, elige el idioma del dashboard. Español es el valor predeterminado; cada página pública configura su idioma por separado.

## 10. Añadir servicios y comprobar la instalación

1. Crea un proyecto y, si lo necesitas, grupos.
2. Para una web o API, crea un monitor HTTP con la URL final o un endpoint `/health`. Usa GET y 2xx inicialmente. Activa seguir redirecciones si el destino devuelve 301, 302 o 307 y quieres comprobar la respuesta final.
3. Para un puerto accesible desde Workers, usa TCP. Solo comprueba la conexión; no valida el protocolo.
4. Para un proceso en segundo plano, crea un heartbeat. Guarda el token al crearlo y configura el proceso para enviar POST periódicos:

   ```sh
   curl -X POST 'https://monitor.example.com/api/v1/heartbeats/MONITOR_ID' \
     -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
     -H 'Content-Type: application/json' \
     --data '{"ok":true}'
   ```

   Define `HEARTBEAT_TOKEN` en el entorno del proceso y reemplaza `MONITOR_ID`. Usa `{"ok":false}` para reportar un fallo. El intervalo y la tolerancia deben corresponder a su ejecución real.

5. Espera las primeras comprobaciones. Simula dos fallos y una recuperación en un servicio de prueba; verifica incidente y notificaciones al destinatario configurado.
6. Crea una página pública: selecciona proyecto, grupos si corresponde, monitores a incluir e idioma. Ábrela en una ventana sin sesión para confirmar que muestra únicamente los servicios elegidos.
7. Comprueba que el dashboard solicita acceso, que otro correo no puede entrar y que los heartbeats no requieren sesión de Access.

La disponibilidad excluye pausas, mantenimiento y períodos sin datos. En 24 horas cada segmento representa 5 minutos; en 7 días, una hora: verde sin interrupciones, rojo ante cualquier interrupción y gris sin registros. En 90 días cada segmento representa un día; amarillo significa disponibilidad parcial y rojo caída durante todo el tiempo observado.

## 11. Cerrar sesión o cambiar el correo de acceso

Usa **Cerrar sesión** junto a los controles del encabezado del dashboard. Abre el endpoint de logout de Access; no borra monitores, historial ni configuración. Este logout revoca la sesión de Access también para otras aplicaciones de la misma organización. Consulta [gestión de sesiones](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

Para cambiar el correo:

1. Añade el correo nuevo a **Include → Emails** en la política Allow de tu aplicación de Access.
2. Cambia la variable de GitHub `ACCESS_EMAIL` al correo nuevo.
3. Vuelve a ejecutar el job de despliegue de un push anterior a `main` desde Actions, o publica tu siguiente cambio en `main`. Editar una variable por sí solo no despliega.
4. Cierra sesión e inicia con el correo nuevo; elimina el anterior de la política después de comprobar el acceso.

El Worker admite solo el correo de la última configuración desplegada. Cambiarlo no modifica el destinatario de las alertas.

## 12. Actualizar, elegir una versión y recuperar

Antes de actualizar, consulta las notas del Release y conserva tus IDs, dominio, configuración y secretos. Lleva el código de la versión elegida a una rama de trabajo, conserva los ajustes de tu instalación y promuévelo a `main`. El pipeline aplicará las migraciones pendientes. No edites migraciones ya aplicadas.

Para el proyecto original, cada promoción a `main` llevará la versión de `package.json` y se publicará como Release con una etiqueta coincidente `vX.Y.Z`. Esa publicación identifica el código; no es un segundo disparador de despliegue ni genera un Release automáticamente con el workflow actual.

Para una recuperación rápida, puedes seleccionar un despliegue anterior sano desde el historial del Worker. Esto no revierte D1 ni restaura automáticamente los secretos. Comprueba la compatibilidad de la versión con el esquema actual y la llave de cifrado; una versión antigua puede necesitar una base independiente o una recuperación de datos. Consulta [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) antes de restaurar datos.

## 13. Probar localmente y resolver problemas

Para una instalación local aislada:

```sh
pnpm db:local
pnpm dev
```

Abre `http://localhost:5173/app/`. `pnpm dev` crea `.dev.vars` desde el ejemplo si no existe. La base, la cola y el acceso son locales; los correos y Telegram se interceptan. Los destinos HTTP/TCP sí reciben comprobaciones: usa servicios de prueba. El logout no aparece porque no hay sesión de Access.

El cron local se activa manualmente y la validación no requiere un build de producción:

```sh
curl http://localhost:8787/__scheduled
pnpm check
```

No uses `wrangler.jsonc` ni migraciones remotas para el desarrollo rutinario. `pnpm deploy` exige un push a `main` dentro de GitHub Actions.

| Problema | Qué revisar |
| --- | --- |
| Actions no se ejecuta | Actions habilitado y push en `main` |
| Fallo de permisos | Cuenta, zona y permisos del token |
| Fallo de migración | Logs de Actions y estado de D1; no omitas la migración |
| Access rechaza o repite el login | Rutas, correo de la política, `ACCESS_EMAIL`, AUD, dominio de equipo y `APP_ORIGIN` |
| Público o heartbeat solicita login | Evita reglas de Access sobre todo el hostname o Worker |
| No llegan alertas | Canal guardado, credenciales, remitente/chat y estados de entrega |
| Monitor pendiente o sin datos | Último cron, trabajos atrasados y configuración de la cola |
| Web marcada caída con 3xx | URL final, redirecciones y códigos aceptados |

Los nombres de los menús de Cloudflare pueden cambiar. Los enlaces oficiales complementan esta guía; la configuración del repositorio determina cómo se despliega esta versión.
