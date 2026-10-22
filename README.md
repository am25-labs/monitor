# AM25 Monitor

[Español](#español) · [English](#english)

## Español

AM25 Monitor te permite supervisar tus sitios, APIs y procesos en segundo plano desde Cloudflare, independientemente del servidor que estás vigilando. Incluye un dashboard privado y páginas públicas para comunicar el estado de tus servicios.

### Qué incluye

- Monitores HTTP/HTTPS, conexiones TCP y heartbeats para procesos sin dominio.
- Proyectos y grupos, incidentes, pausas y ventanas de mantenimiento.
- Hasta 100 monitores, con intervalos desde un minuto.
- Comprobaciones individuales durante seis meses calendario; agregados horarios durante 90 días; agregados diarios e incidentes sin vencimiento automático.
- Hub multicanal de alertas personales con Postmark, Telegram, Pushover y ntfy.
- Páginas públicas con selección de servicios e historial de 24 horas, 7 días o 90 días.
- Dashboard y páginas públicas en español o inglés, con tema claro y oscuro.

React, Vite, TypeScript y shadcn/ui forman la interfaz. Cloudflare Workers ejecuta la aplicación; D1 almacena los datos; Durable Objects programan los ciclos y ejecutan las comprobaciones por monitor; Queues permite procesar mensajes pendientes de versiones anteriores; Access protege el dashboard. No necesitas alojarlo en tu VPS ni configurar R2. El despliegue configura los Durable Objects automáticamente.

### Instalar

La CLI instala la aplicación compilada en tu cuenta de Cloudflare:

```sh
pnpm dlx @am25/monitor init .
```

Consultá la [guía de la CLI](docs/cli/es.md) para instalar, adoptar una instancia existente, diagnosticar y actualizar. El comando requiere una versión publicada en npm; este repositorio prepara su publicación con GitHub Actions y provenance. La [validación en Free](docs/free-plan.md) distingue lo probado de lo pendiente. No se aceptan PR externos; consultá [CONTRIBUTING.md](CONTRIBUTING.md).

La [guía anterior](docs/setup/es.md) se conserva como referencia técnica para instalaciones existentes. Cada instalación utiliza sus propias cuentas, recursos y credenciales.

Los pushes a `main` ejecutan verificaciones de código; los despliegues se administran con la CLI. El consumo y los límites dependen de tu plan de Cloudflare; la retención de seis meses no implica que toda instalación quepa en el plan gratuito.

El límite de cien monitores no garantiza comprobaciones exactas cada minuto. Consulta cómo [validar la fiabilidad del motor](docs/reliability/es.md) con pruebas de carga y mediciones en producción.

### Versiones y Releases

Los GitHub Releases se crean manualmente y son independientes de los despliegues por push a `main`. La versión de `package.json`, la etiqueta `X.Y.Z` y el Release deben corresponder al mismo estado del código al publicar una versión. En Ajustes → Acerca de, el diálogo muestra la versión y el SHA corto del commit desplegado, con enlace al Release de la versión instalada. GitHub Actions incorpora ese SHA al compilar la interfaz mediante `VITE_GIT_SHA`; si no se proporciona, como en desarrollo local, se muestra únicamente la versión.

Se usará versionado semántico: `MAJOR.MINOR.PATCH`. Los cambios incompatibles incrementan la versión mayor, las funciones compatibles la menor y las correcciones la revisión. Durante `0.x`, las versiones menores pueden introducir cambios incompatibles, que se indicarán en las notas del Release.

Los Releases incluirán los cambios, requisitos de configuración y migraciones relevantes. Para instalar una versión concreta, utiliza su etiqueta o su archivo de código fuente en [Releases](https://github.com/am25-labs/monitor/releases), en lugar del estado más reciente de `main`. Conserva la configuración de tu instalación cuando actualices.

Publicar un Release estable activa la [publicación del paquete en npm](docs/publishing.md); no despliega instancias. La adopción desde tu computadora hace el respaldo y el primer despliegue con la CLI sobre los recursos existentes. Las actualizaciones con CLI son explícitas. Volver a código anterior tampoco revierte la base de datos: consultá la guía antes de recuperar una versión.

### Autoría y licencia

Creado por Alejandro Mártir. Copyright 2026 AM25, S.A.S. DE C.V.

Disponible bajo [Apache License 2.0](LICENSE). Consulta [NOTICE](NOTICE) para la atribución del proyecto. Las dependencias conservan sus propias licencias.

## English

AM25 Monitor lets you monitor websites, APIs, and background processes from Cloudflare, independently of the server you are watching. It includes a private dashboard and public pages to communicate the status of your services.

### Features

- HTTP/HTTPS monitors, TCP connections, and heartbeats for processes without a domain.
- Projects and groups, incidents, pauses, and maintenance windows.
- Up to 100 monitors, with intervals starting at one minute.
- Individual checks retained for six calendar months; hourly aggregates retained for 90 days; daily aggregates and incidents without automatic expiry.
- Multichannel personal alert hub with Postmark, Telegram, Pushover, and ntfy.
- Public pages with selected services and 24-hour, 7-day, or 90-day history.
- Dashboard and public pages in Spanish or English, with light and dark themes.

React, Vite, TypeScript, and shadcn/ui power the interface. Cloudflare Workers runs the application; D1 stores data; Durable Objects schedule cycles and run checks per monitor; Queues can process pending messages from earlier versions; Access protects the dashboard. You do not need to host it on your VPS or configure R2. Deployment configures the Durable Objects automatically.

### Install

Install the compiled application with the CLI:

```sh
pnpm dlx @am25/monitor init . --language en
```

See the [CLI guide](docs/cli/en.md) for installation, adoption, diagnosis and updates. The command requires a published npm release; this repository prepares publishing through GitHub Actions with provenance. [Free validation](docs/free-plan.md) distinguishes tested behavior from pending live measurements. External PRs are not accepted; see [CONTRIBUTING.md](CONTRIBUTING.md).

The [previous setup guide](docs/setup/en.md) remains as a technical reference for existing installations. Each installation uses its own accounts, resources, and credentials.

Pushes to `main` check source code; deployments are managed with the CLI. Usage and limits depend on your Cloudflare plan; six-month retention does not mean every installation fits within the free plan.

The hundred-monitor limit does not guarantee checks exactly every minute. See how to [validate engine reliability](docs/reliability/en.md) with load tests and production measurements.

### Versions and Releases

GitHub Releases are created manually and are independent of deployments triggered by pushes to `main`. The version in `package.json`, the `X.Y.Z` tag, and the Release must correspond to the same code state when publishing a version. In Settings → About, the dialog displays the version and the deployed commit's short SHA, linked to the installed version’s Release. GitHub Actions embeds this SHA when compiling the interface through `VITE_GIT_SHA`; when it is absent, as in local development, only the version is displayed.

Semantic versioning will use `MAJOR.MINOR.PATCH`. Breaking changes increase the major version, compatible features the minor version, and fixes the patch version. During `0.x`, minor versions may introduce breaking changes, which will be stated in the Release notes.

Releases will describe changes, configuration requirements, and relevant migrations. To install a specific version, use its tag or source archive from [Releases](https://github.com/am25-labs/monitor/releases), rather than the latest state of `main`. Preserve your installation configuration when updating.

Publishing a stable Release triggers [npm package publishing](docs/publishing.md), without deploying instances. Adoption from your computer backs up and performs the first CLI deployment using existing resources. CLI updates are explicit. Reverting code does not revert the database: consult the guide before recovering a version.

### Author and license

Created by Alejandro Mártir. Copyright 2026 AM25, S.A.S. DE C.V.

Available under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for project attribution. Dependencies retain their own licenses.

Consulta la [documentación de API y MCP de análisis](docs/analytics.md) para retención, credenciales, filtros y conexión de agentes.

See the [analytics API and MCP documentation](docs/analytics.md) for retention, credentials, filters and agent connections.
