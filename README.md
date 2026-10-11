# AM25 Monitor

[Español](#español) · [English](#english)

## Español

AM25 Monitor te permite supervisar tus sitios, APIs y procesos en segundo plano desde Cloudflare, independientemente del servidor que estás vigilando. Incluye un dashboard privado y páginas públicas para comunicar el estado de tus servicios.

### Qué incluye

- Monitores HTTP/HTTPS, conexiones TCP y heartbeats para procesos sin dominio.
- Proyectos y grupos, incidentes, pausas y ventanas de mantenimiento.
- Hasta 100 monitores, con intervalos desde un minuto.
- Comprobaciones individuales durante seis meses calendario; agregados diarios e incidentes cerrados durante 365 días.
- Notificaciones personales por correo mediante Postmark o por Telegram.
- Páginas públicas con selección de servicios e historial de 24 horas, 7 días o 90 días.
- Dashboard y páginas públicas en español o inglés, con tema claro y oscuro.

React, Vite, TypeScript y shadcn/ui forman la interfaz. Cloudflare Workers ejecuta la aplicación; D1 almacena los datos; Queues distribuye las comprobaciones; Access protege el dashboard. No necesitas alojarlo en tu VPS ni configurar R2 o Durable Objects.

### Instalar

Sigue la [guía de configuración en español](docs/setup/es.md). Explica cómo preparar tu repositorio, crear los recursos de Cloudflare, proteger el acceso, conectar tu dominio y activar las notificaciones. Cada instalación utiliza sus propias cuentas, recursos y credenciales.

El despliegue utiliza GitHub Actions y se activa únicamente con cambios en `main`. Funciona con repositorios públicos o privados. El consumo y los límites dependen de tu plan de Cloudflare; la retención de seis meses no implica que toda instalación quepa en el plan gratuito.

### Versiones y Releases

Al publicar el proyecto, cada promoción a `main` se identificará con una versión y un GitHub Release. La versión de `package.json`, la etiqueta `vX.Y.Z` y el Release deben corresponder al mismo estado del código; la versión de la aplicación se muestra en Ajustes.

Se usará versionado semántico: `MAJOR.MINOR.PATCH`. Los cambios incompatibles incrementan la versión mayor, las funciones compatibles la menor y las correcciones la revisión. Durante `0.x`, las versiones menores pueden introducir cambios incompatibles, que se indicarán en las notas del Release.

Los Releases incluirán los cambios, requisitos de configuración y migraciones relevantes. Para instalar una versión concreta, utiliza su etiqueta o su archivo de código fuente en [Releases](https://github.com/am25-labs/monitor/releases), en lugar del estado más reciente de `main`. Conserva la configuración de tu instalación cuando actualices.

Crear un Release o una etiqueta no despliega: el workflow actual se activa por un push a `main`. Los Releases identifican las versiones publicadas; no existe un actualizador automático. Volver a código anterior tampoco revierte la base de datos: consulta la guía antes de recuperar una versión.

### Autoría y licencia

Creado por Alejandro Mártir. Copyright 2026 AM25, S.A.S. DE C.V.

Disponible bajo [Apache License 2.0](LICENSE). Consulta [NOTICE](NOTICE) para la atribución del proyecto. Las dependencias conservan sus propias licencias.

## English

AM25 Monitor lets you monitor websites, APIs, and background processes from Cloudflare, independently of the server you are watching. It includes a private dashboard and public pages to communicate the status of your services.

### Features

- HTTP/HTTPS monitors, TCP connections, and heartbeats for processes without a domain.
- Projects and groups, incidents, pauses, and maintenance windows.
- Up to 100 monitors, with intervals starting at one minute.
- Individual checks retained for six calendar months; daily aggregates and closed incidents retained for 365 days.
- Personal notifications by email through Postmark or through Telegram.
- Public pages with selected services and 24-hour, 7-day, or 90-day history.
- Dashboard and public pages in Spanish or English, with light and dark themes.

React, Vite, TypeScript, and shadcn/ui power the interface. Cloudflare Workers runs the application; D1 stores data; Queues distributes checks; Access protects the dashboard. You do not need to host it on your VPS or configure R2 or Durable Objects.

### Install

Follow the [English setup guide](docs/setup/en.md). It explains how to prepare your repository, create Cloudflare resources, secure access, connect your domain, and enable notifications. Each installation uses its own accounts, resources, and credentials.

Deployment uses GitHub Actions and runs only on changes to `main`. It works with public or private repositories. Usage and limits depend on your Cloudflare plan; six-month retention does not mean every installation fits within the free plan.

### Versions and Releases

Once the project is public, each promotion to `main` will have a version and a GitHub Release. The version in `package.json`, the `vX.Y.Z` tag, and the Release must correspond to the same code state; the application version appears in Settings.

Semantic versioning will use `MAJOR.MINOR.PATCH`. Breaking changes increase the major version, compatible features the minor version, and fixes the patch version. During `0.x`, minor versions may introduce breaking changes, which will be stated in the Release notes.

Releases will describe changes, configuration requirements, and relevant migrations. To install a specific version, use its tag or source archive from [Releases](https://github.com/am25-labs/monitor/releases), rather than the latest state of `main`. Preserve your installation configuration when updating.

Creating a Release or a tag does not deploy: the current workflow runs on a push to `main`. Releases identify published versions; there is no automatic updater. Reverting code does not revert the database either: consult the guide before recovering a version.

### Author and license

Created by Alejandro Mártir. Copyright 2026 AM25, S.A.S. DE C.V.

Available under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for project attribution. Dependencies retain their own licenses.
