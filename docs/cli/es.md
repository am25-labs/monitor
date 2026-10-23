# Instalar Monitor con la CLI

[English](en.md) · [Publicación del paquete](../publishing.md) · [Validación de Free](../free-plan.md)

Necesitás Node.js 24.22.1, pnpm 10.23+, una cuenta de Cloudflare y un dominio con zona DNS activa en esa cuenta. Elegí un hostname dedicado y sin registros DNS existentes. No necesitás GitHub, clonar el código, un agente ni compilar la aplicación.

```sh
mkdir my-monitor
cd my-monitor
pnpm dlx @am25/monitor init .
```

El wizard permite elegir español o inglés; también admite `--language es` y `--language en`. Seleccioná tu cuenta y zona, hostname, nombre del Worker y correo del propietario. Las alertas se configuran después desde el dashboard y pueden tener otro destinatario.

## Autenticación y requisitos

En Cloudflare → My Profile → API Tokens → Create Token, creá un token personalizado limitado a la cuenta y zona elegidas, con estos permisos de edición:

- Workers Scripts, D1 y Queues.
- Access: Apps and Policies.
- Access: Organizations, Identity Providers, and Groups.
- Workers Routes y DNS para la zona.
- Lectura de Account Settings y de la zona para descubrir la cuenta y el dominio.

La CLI verifica la visibilidad de recursos antes de actuar. Las restricciones efectivas de escritura también se validan al ejecutar cada operación; una consulta de lectura exitosa no garantiza todos los permisos de edición.

Ingresá el token en la entrada oculta o suministralo mediante `CLOUDFLARE_API_TOKEN`, preferentemente desde tu gestor de secretos. No uses la Global API Key ni incluyas el token como argumento. La CLI no lo guarda ni utiliza credenciales del agente. Si Cloudflare exige renovar o ampliar permisos, repetí el mismo comando con el token corregido.

Si falta Zero Trust, el wizard te indica cómo completar su alta y vuelve a verificarla cuando confirmás. Cloudflare puede solicitar selección de plan y datos de pago. La CLI no contrata servicios ni cambia planes. Después crea o reutiliza One-time PIN y crea una aplicación que protege únicamente `/app`, `/app/*`, `/api/v1/admin` y `/api/v1/admin/*`.

## Archivos y mantenimiento

La instalación queda dentro de `.monitor/`, excluida de Git, con configuración y secretos separados, caché de versiones y respaldos. No edites los archivos de las versiones cacheadas: su integridad se verifica antes de usarlos.

Guardá una copia segura de `.monitor/secrets.json`. Conservá esa misma `CONFIG_KEY` al recuperar la base: cambiarla impide descifrar credenciales existentes. El token de Cloudflare no forma parte de ese archivo.

Desde la carpeta de instalación:

```sh
pnpm dlx @am25/monitor deploy
pnpm dlx @am25/monitor doctor
pnpm dlx @am25/monitor@latest update
```

`deploy` publica la versión instalada, aunque invoqués una CLI más reciente. `update` usa la versión incluida en la CLI invocada. Para una versión específica:

```sh
pnpm dlx @am25/monitor@X.Y.Z update
```

Solo `init` recibe un destino posicional. Desde otra ubicación usá `--cwd /ruta/a/my-monitor`. Las actualizaciones pueden saltar versiones intermedias sin una lista de versiones permitidas; no se permiten downgrades. Las migraciones previas deben conservar su nombre y contenido.

## Reanudación y recuperación

Repetí el mismo comando con la misma versión de CLI para reanudar una operación fallida. No borres la carpeta ni generes otra llave. El estado distingue migraciones aplicadas, publicación pendiente y versión desplegada.

Antes de migrar una instalación existente, la CLI respalda configuración, secretos y D1 en `.monitor/backups/`. Si falla el respaldo no migra ni despliega. Conserva ese mismo respaldo al reanudar; no lo sustituye por una copia posterior a una migración parcial.

Una creación remota sin respuesta confirmada se registra como `pending` y detiene nuevos intentos. Revisá el tipo de recurso, sus nombres en `installation.json` y Cloudflare. Solo después de identificar inequívocamente el recurso creado, incorporá su ID real en `resources` y quitá `pending`; si confirmaste que no fue creado, quitá únicamente `pending`. No adoptes recursos compartidos ni borres recursos para resolverlo.

Si una operación fue terminada abruptamente, puede quedar `.monitor/operation.lock`. Verificá que el proceso indicado ya no está ejecutándose antes de quitar ese archivo. Ejecutá solo una CLI por instalación y no operes simultáneamente desde copias de la carpeta en distintas computadoras.

Las migraciones no se revierten automáticamente. Ante una migración incompatible o parcialmente fallida, detené las publicaciones, preservá los respaldos y seguí las notas de recuperación del release. Restaurar D1 puede perder datos posteriores al respaldo y requiere intervención explícita. D1 no incluye el estado de Durable Objects; volver al código anterior tampoco revierte el esquema. Nunca elimines namespaces durante una recuperación.

## Adoptar una instalación existente

Desde tu Mac, en una carpeta nueva, ejecutá:

```sh
pnpm dlx @am25/monitor init . --adopt
```

El wizard pide la ruta al `wrangler.jsonc` original, el correo del propietario y la llave original de producción mediante entrada oculta. No tenés que configurar variables en GitHub ni ejecutar otra vez el pipeline anterior. El token de Cloudflare se ingresa en el mismo wizard.

El `wrangler.jsonc` del repositorio contiene valores de ejemplo. Para adoptar, proporcioná el archivo con la configuración real de tu instancia. Si conservás una copia local como `wrangler.instance.jsonc`, ese nombre está excluido de Git; ingresá su ruta completa en el wizard.

La CLI verifica recursos, Access, las migraciones existentes y la llave contra datos cifrados. También verifica que la versión seleccionada esté publicada con provenance. Para adoptar, el esquema debe coincidir con esa versión; las instalaciones sin metadatos de versión previos también se aceptan. Si no hay datos cifrados pide confirmar que conservás la llave original.

Al confirmar, respalda configuración, secretos y D1, y despliega la versión de la CLI sobre el mismo Worker, base, cola, dominio y namespaces. Solo marca la adopción como terminada después de verificar la publicación. Si falla, repetí el mismo comando con la misma versión de CLI: reutiliza el respaldo y los datos ya solicitados.

GitHub ahora valida código y publica paquetes en npm; no despliega tu instancia ni requiere secretos de Cloudflare. Los secretos anteriores pueden permanecer allí sin uso: no tenés que modificarlos para adoptar. Después administrás Monitor desde esta carpeta con `deploy`, `update` y `doctor`.

La adopción requiere la configuración estándar de Monitor, una aplicación de Access y One-time PIN. Las personalizaciones requieren conciliación manual, sin reemplazarlas automáticamente.

## Diagnóstico

`doctor` solo realiza consultas remotas de lectura. Comprueba integridad local, bindings, namespaces, Access, dominio, cron, migraciones, ciclo reciente del motor y respuestas HTTP sin sesión. Un ciclo todavía no observado tras instalar puede requerir esperar unos minutos y repetirlo.

Iniciar sesión con el propietario y comprobar una página de estado real siguen siendo verificaciones humanas. El diagnóstico no envía alertas, no crea monitores y no envía heartbeats. Un resultado correcto tampoco certifica capacidad de carga ni disponibilidad futura de las cuotas gratuitas.
