# Configurar AM25 Monitor

[English](en.md) · [Presentación](../../README.md)

Esta guía instala AM25 Monitor en tu cuenta de Cloudflare usando GitHub Actions. Los ejemplos usan `monitor.example.com` y `owner@example.com`: reemplázalos por tus datos. No copies los identificadores de la instalación de AM25 que pueda contener la configuración del repositorio.

## Instalación asistida con un agente (opcional)

Puedes realizar esta guía con tu agente de programación preferido. Recomendamos instalar su plugin de Cloudflare o conectar un servidor MCP oficial compatible y autenticarlo con tu cuenta. Consulta las [opciones oficiales de conexión de Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/). La forma de instalarlo depende del agente; esta opción no exige usar Codex.

Abre el repositorio en el agente, conecta Cloudflare y copia el siguiente prompt. El agente debe pedir tus datos y comprobar sus herramientas y permisos: algunos conectores solo consultan documentación o no administran Access. Autenticar el plugin tampoco configura automáticamente las credenciales del pipeline de GitHub.

```text
Ayúdame a instalar AM25 Monitor en mi propia cuenta siguiendo docs/setup/es.md.
Lee primero las instrucciones del repositorio, la guía completa y la configuración
actual. No reutilices los IDs, dominios ni correos de la instalación original.

Antes de cambiar recursos, pídeme los datos que falten:
- Repositorio de GitHub y carpeta local donde trabajaremos.
- Versión X.Y.Z que quiero instalar, sin prefijo v, y rama de trabajo.
- Cuenta de Cloudflare: ayúdame a identificar su nombre y Account ID.
- Zona DNS y hostname dedicado de Monitor; verifica que la zona esté activa.
- Correo que autorizaré para iniciar sesión; no asumas que será el de las alertas.
- Nombres para el Worker, D1, cola y aplicación de Access, o si quiero reutilizar
  recursos existentes dedicados a esta instalación.
- Si ya tengo organización de Zero Trust y One-time PIN configurados.
- Canales de notificaciones (Postmark, Telegram, Pushover o ntfy) y los datos no secretos necesarios
  para configurarlo, si quiero activarlo durante la instalación.

Usa el plugin o MCP de Cloudflare autenticado. Comprueba la cuenta seleccionada,
los permisos y las operaciones disponibles antes de actuar. Consulta la documentación
oficial actual para los pasos de Cloudflare. Muéstrame los recursos que vas a crear
o reutilizar y confirma conmigo la cuenta y el dominio de destino. No elimines ni
modifiques recursos compartidos o de otros servicios. Si hay un conflicto de DNS
u otro cambio destructivo, explica el conflicto y solicita autorización específica.

Con mis datos, completa los pasos de la guía que tus herramientas permitan:
1. Crea o identifica D1 y la cola de esta instalación.
2. Prepara Zero Trust y One-time PIN. Si hay un asistente de plan, contratación
   o autorización que deba completar yo, guíame y espera a que lo termine.
3. Crea la aplicación de Access con las cuatro rutas privadas de la guía y una
   política Allow / Include / Emails con mi correo. Mantén públicas las rutas
   de estado y heartbeats. Si ya existe, verifica su configuración sin duplicarla.
4. Obtén el dominio de equipo y los AUD reales. Actualiza wrangler.jsonc con mis
   recursos y Custom Domain; conserva bindings, cron y configuración de seguridad.
5. Ayúdame a configurar los cuatro Repository secrets de GitHub:
   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, MONITOR_CONFIG_KEY y ACCESS_EMAIL.
   ACCESS_EMAIL debe coincidir con la política de Access y no quedar en archivos.
   Usa una entrada segura de secretos o indícame dónde pegarlos personalmente;
   no me pidas tokens ni la llave en el chat y no los imprimas en logs, archivos
   versionados o informes. Explica cómo generar y respaldar la llave de cifrado.
   El token del plugin no sustituye al token de despliegue de GitHub Actions.
6. Verifica los cambios con pnpm check y revisa el diff. No ejecutes un build
   de producción local ni migraciones remotas como validación de desarrollo.
7. Entrégame el resumen de recursos configurados y los pasos que falten. No
   hagas staging, commits, pushes, promociones a main ni Releases por mí.
   Yo publicaré en main para que GitHub Actions migre y despliegue.
8. Después de que te confirme el despliegue, verifica dominio, acceso privado,
   página pública, cron y heartbeat. Ayúdame a guardar el canal de alertas en
   el dashboard mediante entrada segura. Pídeme autorización antes de provocar
   caídas de prueba o enviar notificaciones reales al destinatario que yo indique.

Si falta una herramienta o permiso, no afirmes que el paso se completó: dime qué
operación está pendiente y guíame por las pantallas exactas para hacerla manualmente.
No cambies de cuenta, plan o método de despliegue sin consultarme. Conserva la misma
llave al reutilizar datos cifrados. En el informe final omite mi correo real y los
secretos. Distingue lo configurado de lo verificado y de lo pendiente.
```

El agente puede ayudar a preparar toda la instalación, pero la selección de plan, las autorizaciones de cuenta y las operaciones que el conector no soporte requieren tu intervención. Los pasos numerados siguientes siguen siendo la referencia para instalar manualmente y revisar el trabajo del agente.

## 1. Preparar las cuentas y el dominio

Necesitas una cuenta de GitHub con Actions habilitado, una cuenta de Cloudflare con Workers, Durable Objects, D1, Queues y Zero Trust disponibles, y un dominio cuya zona DNS esté activa en la misma cuenta de Cloudflare.

Elige un subdominio dedicado, por ejemplo `monitor.example.com`, que no sirva otra aplicación. No necesitas un VPS para alojar Monitor. Para los pasos locales, instala Git, Node.js 22.14 o superior y la versión de pnpm indicada en `package.json`.

Revisa los límites y el consumo antes de elegir tu plan. A un minuto, 100 monitores generan unas 144,000 comprobaciones diarias y unos 26 millones en seis meses, además de índices y agregados. Consulta los [límites de D1](https://developers.cloudflare.com/d1/platform/limits/), los [precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) y los [precios de Queues](https://developers.cloudflare.com/queues/platform/pricing/).

## 2. Preparar tu repositorio y elegir una versión

Crea un fork o un repositorio propio con el código del proyecto, público o privado. Si quieres una versión específica, obtén el código de su etiqueta `X.Y.Z` o descarga su archivo desde [Releases](https://github.com/am25-labs/monitor/releases). Prepara esa versión en una rama de tu repositorio antes de llevarla a `main`; no mezcles archivos de Releases distintos.

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

Completa este paso antes del primer despliegue. El pipeline crea el Worker, pero no crea la organización de Zero Trust, el método de inicio de sesión ni la política de Access.

**Zero Trust** es el panel de seguridad de Cloudflare. **Access** es el servicio dentro de ese panel que muestra el inicio de sesión del dashboard. Una **aplicación** indica qué dominio y rutas proteger; una **política Allow** indica qué correo puede entrar. Estos recursos se configuran en Cloudflare, no en GitHub ni en tu VPS.

### 4.1. Entrar a Zero Trust y preparar la organización

1. Abre el [panel de Cloudflare](https://dash.cloudflare.com/) e inicia sesión.
2. Selecciona la misma cuenta donde creaste D1 y la cola en el paso 3. Si tienes varias cuentas, comprueba el nombre y el Account ID antes de continuar.
3. En el menú de esa cuenta, abre **Zero Trust**. También puedes acceder al [panel de Cloudflare One](https://one.dash.cloudflare.com/) y seleccionar esa cuenta.
4. Si aparece un asistente de bienvenida, crea tu organización: elige un nombre de equipo, selecciona el plan adecuado y completa los datos de contratación que solicite Cloudflare. El asistente puede pedir datos de pago incluso para el plan gratuito.
5. Si ya aparece el panel de Zero Trust, utiliza la organización existente; no necesitas crear otra.
6. En **Zero Trust → Settings**, identifica el nombre de equipo. Guarda su URL completa, por ejemplo `https://my-team.cloudflareaccess.com`: este será el valor de `ACCESS_TEAM_DOMAIN`. No es el dominio público de Monitor.

Al terminar debes poder abrir el panel de Zero Trust y conocer tu dominio de equipo. Consulta la [configuración inicial de Zero Trust](https://developers.cloudflare.com/cloudflare-one/setup/).

### 4.2. Activar el inicio de sesión por correo

1. Dentro de Zero Trust, abre **Integrations → Identity providers**.
2. En **Your identity providers**, selecciona **Add new identity provider**.
3. Elige **One-time PIN** y completa su creación. Si ya está en la lista, reutilízalo.

One-time PIN envía un código al correo autorizado cuando intentas entrar al dashboard. Las organizaciones nuevas pueden traer el proveedor Cloudflare como predeterminado; eso no significa que One-time PIN ya esté activo. Este método no requiere configurar Postmark: las alertas de Monitor se configuran por separado. Consulta [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

### 4.3. Crear la aplicación del dashboard

1. Dentro de Zero Trust, abre **Access controls → Applications**. En interfaces anteriores puede aparecer como **Access → Applications**.
2. Selecciona **Create new application** o **Add an application**, según la interfaz.
3. Elige **Self-hosted and private** (o **Self-hosted**) y asigna el nombre `Monitor dashboard`.
4. Usa **Add public hostname** para añadir el dominio que elegiste, por ejemplo `monitor.example.com`, con cada una de estas rutas. Todas deben pertenecer a esta aplicación:

   | Hostname | Path |
   | --- | --- |
   | `monitor.example.com` | `/app` |
   | `monitor.example.com` | `/app/*` |
   | `monitor.example.com` | `/api/v1/admin` |
   | `monitor.example.com` | `/api/v1/admin/*` |

   Si Cloudflare separa el hostname en campos, usa `monitor` como subdominio y `example.com` como dominio. El campo Path contiene la ruta; no escribas una URL completa en él.

5. En los métodos de autenticación de la aplicación, selecciona **One-time PIN**. No dejes seleccionados todos los proveedores si solo quieres entrar mediante código al correo.
6. Continúa con la política del siguiente apartado antes de guardar la aplicación.

No añadas una entrada sin Path que proteja todo el hostname ni actives la protección de todo el Worker. Las páginas públicas y los heartbeats deben funcionar sin sesión. Mantén fuera de estas reglas `/status/*`, `/api/v1/public/*`, `/api/v1/heartbeats/*`, `/assets/*` y `/cdn-cgi/access/*`. Consulta [aplicaciones de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

### 4.4. Autorizar el correo y guardar la audiencia

1. En **Access policies** de la aplicación, crea una política. Puedes llamarla `Monitor owner`.
2. En **Action**, elige **Allow**.
3. Añade una regla **Include** y selecciona **Emails** como selector.
4. Introduce únicamente el correo con el que entrarás, por ejemplo `owner@example.com`. No elijas Everyone ni un dominio de correo completo para esta instalación de un solo propietario.
5. Guarda la política y comprueba que esté asociada a `Monitor dashboard`. Termina de guardar la aplicación.
6. Abre la configuración o los detalles de la aplicación y copia **Application Audience (AUD) Tag**. Guarda ese valor para `ACCESS_AUDIENCES`; no copies el ID de la política ni el ID de la aplicación en su lugar.

El mismo correo debe guardarse después como secreto `ACCESS_EMAIL` en GitHub, en el paso 7. Son dos comprobaciones distintas:

| Lugar | Qué configurar | Ejemplo |
| --- | --- | --- |
| Cloudflare, política de Access | **Allow → Include → Emails** | `owner@example.com` |
| GitHub, Repository secrets | **ACCESS_EMAIL** | `owner@example.com` |

Access admite el acceso según la política; el Worker valida además el JWT y comprueba que el correo coincida con `ACCESS_EMAIL`. Configurarlo en un solo lugar no completa la instalación. El destinatario de las alertas puede ser otro correo.

Usa una sola aplicación con las cuatro rutas para compartir audiencia y sesión. Si ya tienes aplicaciones separadas, utiliza la misma política para el propietario y copia sus audiencias en `ACCESS_AUDIENCES`, separadas por comas. Consulta [políticas de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

Antes de continuar debes tener tres datos: la URL del equipo, el AUD de la aplicación y el correo autorizado. La aplicación puede configurarse antes de publicar el Worker; probar el inicio de sesión corresponde al paso 8.

### 4.5. Encontrar una aplicación ya configurada

Si Monitor ya solicita un código al entrar, primero busca su configuración existente:

1. Abre Cloudflare, selecciona la cuenta correcta y entra a **Zero Trust → Access controls → Applications**.
2. Busca `Monitor dashboard` o la aplicación cuyo hostname coincida con tu dominio de Monitor. El nombre puede ser distinto si lo elegiste durante la instalación.
3. Ábrela para editar y entra a **Policies / Access policies**.
4. Abre la política con acción **Allow** y revisa **Include → Emails**. Ahí está el correo autorizado.

Si no ves la aplicación, revisa la cuenta seleccionada y el hostname antes de crear otra. El paso 11 explica cómo cambiar el correo sin perder acceso.

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

Conserva los bindings `DB`, `CHECKS`, `ASSETS`, `SCHEDULER` y `CHECK_RUNNERS`, `migrations_dir`, `run_worker_first`, el cron por minuto y los límites de consumidores. Mantén `workers_dev` y `preview_urls` en `false`. No añadas el correo a `vars`: `ACCESS_EMAIL` se suministra desde GitHub.

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
| `ACCESS_EMAIL` | El mismo correo autorizado en la política Allow de Access |

Genera la llave en tu computadora:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarda una copia segura de esta llave. Cifra credenciales y configuración de notificaciones: reemplazarla sin migrar los datos hace que los valores existentes no puedan descifrarse.

Los cuatro valores deben estar en **Repository secrets**, no en la pestaña Variables. El workflow lee `secrets.ACCESS_EMAIL`; un valor guardado solamente en Variables no se recibirá. El correo queda fuera del código versionado y se instala en Cloudflare como Worker Secret `ACCESS_EMAIL`, junto con `CONFIG_KEY`. Si falta o no tiene formato válido, el despliegue se detiene antes de ejecutar migraciones.

No configures credenciales de los canales de notificaciones en GitHub. Se guardan desde el dashboard, cifrados en D1. Los datos locales de `.dev.vars` no configuran producción.

## 8. Publicar por primera vez

Revisa los valores y lleva los cambios a `main` en tu repositorio. Ese push activa **Actions → Deploy production**. Los pushes a `develop`, los pull requests, las etiquetas y la creación de Releases no activan el despliegue.

El workflow instala con el lockfile, verifica TypeScript, ejecuta pruebas, compila la interfaz, aplica migraciones D1 y despliega Worker, assets y secretos. Un error detiene los pasos siguientes; un fallo de migración impide publicar el Worker. Los despliegues se ejecutan en serie.

Espera a que Actions termine correctamente. En Cloudflare, comprueba que tu Worker tiene el Custom Domain, el cron, los bindings `SCHEDULER` y `CHECK_RUNNERS`, la base y la cola asociados. Abre `https://monitor.example.com/app/`, inicia sesión con el correo autorizado y confirma que el overview muestra una ejecución reciente del motor.

## 9. Activar las notificaciones

Abre **Ajustes → Notificaciones**. Activa uno o varios canales y guarda los cambios:

- **Correo:** crea un servidor en Postmark, verifica el remitente o su dominio y copia su **Server API Token**. Configura token, destinatario, remitente verificado y stream transaccional (habitualmente `outbound`). El destinatario puede ser diferente del correo de Access.
- **Telegram:** crea un bot con BotFather, copia su token e inicia una conversación con el bot. Obtén el ID numérico de tu chat personal y configura token e ID. Consulta el [tutorial de Telegram](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).

- **Pushover:** instala la app, crea tu cuenta en [Pushover](https://pushover.net/) y registra una aplicación con el nombre AM25 Monitor. Copia su **API Token** y tu **User Key** en el dashboard. Si habilitas las repeticiones, las caídas confirmadas usan prioridad de emergencia: por defecto, cada 60 segundos durante 1800 segundos (30 minutos), hasta confirmar en la app o recuperarse el servicio. Pushover limita cada alerta a 50 repeticiones y tres horas como máximo. La recuperación cancela las repeticiones pendientes y se envía como notificación normal. En iPhone, autoriza las alertas críticas en Pushover y en Ajustes de iOS; prueba el sonido con el teléfono bloqueado y en tu modo nocturno habitual. La app ofrece 30 días de prueba y una compra única por plataforma, sin cobro automático al finalizar la prueba. Consulta sus [precios](https://pushover.net/pricing).
- **ntfy:** instala la app y suscríbete a un tema en [ntfy.sh](https://ntfy.sh/) o en un servidor propio que viva fuera de la infraestructura vigilada. Configura la URL HTTPS del servidor, el mismo tema y, si requiere autenticación, un token de acceso. En ntfy.sh gratuito los temas no son privados: usa un nombre largo y aleatorio, como `monitor-` seguido de 32 caracteres aleatorios, y evita nombres conocidos. Quien conozca el tema puede leer y publicar mensajes. El servicio público gratuito limita los envíos a 250 mensajes diarios. Monitor envía prioridad urgente para una caída y normal para una recuperación, sin repetición automática. Las alertas críticas de iOS figuran todavía como no publicadas en las [notas de versiones](https://docs.ntfy.sh/releases/); no dependas de ntfy para saltarte silencio o No molestar en iPhone.

Las alertas son personales y se envían a todos los canales activos por apertura y recuperación, sin suscripciones de clientes. Cada canal mantiene sus propias entregas y reintentos: el fallo de uno no repite los envíos exitosos de otro. Revisa los fallos por canal en el overview; Reintentar vuelve a intentar las entregas fallidas de ese evento. Los tokens, la clave de usuario y el tema se guardan cifrados y no se devuelven al navegador; dejarlos vacíos conserva el valor existente.

La configuración anterior de un solo canal se conserva automáticamente al actualizar. Hasta guardar la configuración, no se entregan notificaciones; los intentos pendientes pueden terminar en fallo. Si guardas todos los canales desactivados, los nuevos eventos no enviarán alertas. Desactivar Pushover no cancela inmediatamente una alarma ya enviada: puedes confirmarla en la app; Monitor también la cancela cuando procesa la recuperación. Si una respuesta del proveedor se pierde, puede haber envíos duplicados.

En **Incidentes → Proveedor de infraestructura**, usa **Activar incidente del proveedor** ante una falla externa general. Publica un aviso en español e inglés para todos los monitores, agrupado por proyecto, y silencia las alertas de caída, sus reintentos y las repeticiones de emergencia de Pushover. Las comprobaciones, el historial de disponibilidad y las notificaciones de recuperación de cada monitor continúan. Los estados de los servicios pueden recuperarse aunque el aviso general siga abierto. Usa **Finalizar incidente del proveedor** para cerrar los avisos y volver a habilitar las alertas de caída; los avisos silenciados no se reenvían. Las pausas y mantenimientos conservan su comportamiento habitual.

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

La disponibilidad excluye pausas, mantenimiento y períodos sin datos. En 24 horas cada segmento representa 5 minutos; en 7 días, una hora; en 90 días, un día UTC. En 24 horas, verde indica disponibilidad sin afectación y amarillo degradación por latencia. Gris indica ausencia de registros en todas las vistas. En 24 horas cualquier interrupción se muestra en rojo. En 7 y 90 días, el color se calcula sobre la disponibilidad observada de cada segmento: verde desde 99.9%, amarillo desde 95% hasta menos de 99.9% y rojo por debajo de 95%. La degradación por latencia conserva el amarillo aunque la disponibilidad alcance 99.9%. Un minuto de interrupción en un día completo queda verde; un minuto en una hora completa queda amarillo. Las interrupciones siempre se conservan en el detalle, aunque el segmento sea verde; el estado actual del servicio se evalúa por separado. Azul identifica segmentos con mantenimiento registrado, salvo que su estado sea degradado o caído según el criterio de la vista, que conserva su prioridad. El tooltip muestra por separado los segundos de mantenimiento, excluidos de la disponibilidad y de la cobertura esperada.

## 11. Cerrar sesión o cambiar el correo de acceso

Usa **Cerrar sesión** junto a los controles del encabezado del dashboard. Abre el endpoint de logout de Access; no borra monitores, historial ni configuración. Este logout revoca la sesión de Access también para otras aplicaciones de la misma organización. Consulta [gestión de sesiones](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

Para cambiar el correo:

1. Encuentra tu aplicación y su política siguiendo el apartado 4.5. Añade el correo nuevo a **Allow → Include → Emails** sin eliminar todavía el anterior.
2. Cambia el secreto del repositorio `ACCESS_EMAIL` en GitHub al correo nuevo.
3. Vuelve a ejecutar el job de despliegue de un push anterior a `main` desde Actions, o publica tu siguiente cambio en `main`. Editar un secreto por sí solo no despliega. Si reejecutas un job, elige una ejecución cuyo workflow ya lea `secrets.ACCESS_EMAIL`: reejecutar una ejecución antigua no actualiza su archivo de workflow.
4. Cierra sesión e inicia con el correo nuevo; elimina el anterior de la política después de comprobar el acceso.

El Worker admite solo el correo de la última configuración desplegada. Cambiarlo no modifica el destinatario de las alertas.

## 12. Actualizar, elegir una versión y recuperar

Antes de actualizar, consulta las notas del Release y conserva tus IDs, dominio, configuración y secretos. Lleva el código de la versión elegida a una rama de trabajo, conserva los ajustes de tu instalación y promuévelo a `main`. El pipeline aplicará las migraciones pendientes. No edites migraciones ya aplicadas.

Para el proyecto original, cada promoción a `main` llevará la versión de `package.json` y se publicará como Release con una etiqueta coincidente `X.Y.Z`. Esa publicación identifica el código; no es un segundo disparador de despliegue ni genera un Release automáticamente con el workflow actual.

Para una recuperación rápida, puedes seleccionar un despliegue anterior sano desde el historial del Worker. Esto no revierte D1 ni restaura automáticamente los secretos. Comprueba la compatibilidad de la versión con el esquema actual y la llave de cifrado; una versión antigua puede necesitar una base independiente o una recuperación de datos. Consulta [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) antes de restaurar datos.

La migración del hub añade una tabla de entregas sin eliminar datos existentes. Después de guardar una configuración multicanal, no regreses a una versión anterior al hub: esas versiones solo interpretan un canal. Conserva la versión que soporta el hub o adapta la configuración cifrada antes de una recuperación de ese tipo.

## 13. Probar localmente y resolver problemas

Para una instalación local aislada:

```sh
pnpm db:local
pnpm dev
```

Abre `http://localhost:5173/app/`. `pnpm dev` crea `.dev.vars` desde el ejemplo si no existe. La base, la cola y el acceso son locales; todos los canales de notificaciones se interceptan. Los destinos HTTP/TCP sí reciben comprobaciones: usa servicios de prueba. El logout no aparece porque no hay sesión de Access.

El cron local se activa manualmente para iniciar el programador; las alarmas continúan los ciclos. Conserva también `durable_objects` y `migrations` en Wrangler. El despliegue crea el programador y los ejecutores Durable Object automáticamente, sin secretos adicionales. La validación no requiere un build de producción:

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
| Monitor pendiente o sin datos | Alarmas del programador, último ciclo, trabajos atrasados y configuración de la cola |
| Web marcada caída con 3xx | URL final, redirecciones y códigos aceptados |

Los nombres de los menús de Cloudflare pueden cambiar. Los enlaces oficiales complementan esta guía; la configuración del repositorio determina cómo se despliega esta versión.
