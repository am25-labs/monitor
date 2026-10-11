# AM25 Monitor

Monitor personal independiente del VPS: React + Vite, Workers, D1, Queues y Cloudflare Access. Interfaz y correos en español. No usa Gate ni Durable Objects.

## Desarrollo

Trabajar en `develop`. Solo el propietario hace commits, pushes y promociones a `main`.

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

Abrir `http://localhost:5173/app/`. El script crea `.dev.vars` con valores locales si no existe. D1, colas y autenticación son locales; los correos se interceptan y nunca se envían. Para disparar el cron simulado, usar `curl http://localhost:8787/__scheduled`. No hay cron automático en la configuración local. Los destinos de monitores locales sí reciben comprobaciones: usar servicios de prueba propios.

Validación: `pnpm check`. No ejecutar compilaciones de producción como validación local rutinaria; GitHub Actions ejecuta `pnpm build`. No usar `wrangler.jsonc` para desarrollo ni aplicar migraciones remotas desde `develop`.

## Producción y repositorio privado

GitHub Actions sustituye Workers Builds. No conectar un segundo pipeline de Cloudflare. La validación de desarrollo se ejecuta localmente con `pnpm check`. `.github/workflows/deploy.yml` valida y publica únicamente tras un push a `main`; los pushes a `develop` y los pull requests no ejecutan workflows. El checkout usa el token del repositorio privado y no necesita hacerlo público.

Secuencia: instalación con lockfile → TypeScript → pruebas → frontend → migraciones D1 → secretos → Worker y assets. Cualquier error detiene los pasos posteriores. Los despliegues se serializan y no se cancelan a mitad de una migración. El script de publicación exige un evento push de GitHub Actions en `main`.

Recursos creados y registrados en `wrangler.jsonc`:

- Cuenta AM25: `00000000000000000000000000000000`.
- D1 `am25-monitor`: `00000000-0000-0000-0000-000000000000`.
- Cola `am25-monitor-checks`: `c7ebb04c99da4be8a716695deb0762a7`.
- Aplicación Access `AM25 Monitor`: `b49a40db-8e0c-402e-8ca1-6f677f9bc7ec`.
- Acceso mediante código al correo, autorizado únicamente para `owner@example.com`.

El primer despliegue crea/actualiza el Worker `am25-monitor` y conecta su Custom Domain `monitor.example.com` en la zona activa de Cloudflare. `workers.dev` y URLs de preview están deshabilitados. No se publicó una aplicación de producción durante el desarrollo.

En GitHub → Settings → Secrets and variables → Actions, crear secretos del repositorio:

| Secreto                  | Valor                                             |
| ------------------------ | ------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | Cuenta indicada arriba                            |
| `CLOUDFLARE_API_TOKEN`   | Token limitado a esta cuenta y zona               |
| `MONITOR_CONFIG_KEY`     | 32 bytes aleatorios en hexadecimal: 64 caracteres |
| `MONITOR_POSTMARK_TOKEN` | Server API Token de Postmark                      |

El token necesita edición de Workers Scripts, D1 y Queues en la cuenta; edición de Workers Routes y DNS en la zona `am25.app` para el dominio. No necesita administrar Access: la aplicación ya está configurada. Mantener los secretos fuera del repositorio y respaldar la llave de cifrado. No sustituirla sin migrar las configuraciones cifradas existentes.

Los secretos se pasan mediante un archivo temporal con permisos 0600, eliminado al terminar, y se publican junto con la versión del Worker; esto también funciona en el primer despliegue. Los secretos de GitHub se instalan como Workers Secrets `CONFIG_KEY` y `POSTMARK_TOKEN`. El remitente de Postmark debe estar verificado como `noreply@am25.work`, con stream transaccional `outbound`. Todas las alertas se envían únicamente a `support@am25.work`. No hay notificaciones para clientes.

No se configuraron secretos de GitHub: la sesión local de `gh` no está autenticada y el token de Postmark debe proporcionarlo el propietario. Después de configurarlos, el propietario promueve y pushea a `main`.

## Seguridad y rutas

`/` redirige a `/app/`. Access protege `/app`, `/app/*`, `/api/v1/admin` y `/api/v1/admin/*`. El Worker verifica JWT RS256, emisor, audiencia, expiración e identidad antes de servir assets privados. Las escrituras administrativas validan el origen.

`/status/:slug` y `/api/v1/public/:slug` son públicos y de lectura. Solo muestran monitores seleccionados, disponibilidad e incidentes sanitizados; no publican destinos, credenciales, respuestas ni diagnósticos. `/api/v1/heartbeats/:id` acepta POST con `Authorization: Bearer TOKEN` y JSON `{"ok":true}` o `{"ok":false}`, sin sesión de Access. El token se muestra al crearlo/regenerarlo y se guarda únicamente su hash.

Las configuraciones se cifran con AES-GCM y contexto por monitor. La API administrativa redacta headers; editar sin reemplazar credenciales conserva los existentes. Los errores guardados usan mensajes sanitizados, nunca cuerpos de respuesta.

## Motor, historial y operación

Hasta 100 monitores con intervalo mínimo de 60 segundos. Cron cada minuto, lotes de cinco mensajes y máximo cinco consumidores. Reservas de 90 segundos, identidad por monitor/configuración/período y transacciones D1 evitan duplicados y resultados de versiones anteriores. Los trabajos atrasados o errores del motor dejan ausencia de datos; no producen fallos falsos del destino.

HTTP usa GET, 2xx, sin redirecciones y timeout de 10 segundos por defecto. Admite HEAD, headers, códigos/rangos, texto y JSON Pointer; lectura máxima 256 KiB. TCP comprueba exclusivamente conexión a host/puerto accesible desde Workers. Heartbeats tienen tolerancia inicial de un minuto y una muestra por período; reportes repetidos refrescan la recepción.

Incidentes tras dos fallos y recuperación con un éxito, ambos configurables. Pausas excluyen observación. Durante mantenimiento siguen las comprobaciones, se suspenden transiciones/alertas y se reinician contadores al terminar. La disponibilidad usa segundos observados, excluyendo mantenimiento y ausencia de datos.

Se conservan resultados individuales seis meses calendario; agregados diarios e incidentes cerrados, 365 días. Limpieza por lotes de hasta 1000 filas por tabla en cada cron. Los incidentes abiertos se conservan. Los agregados diarios usan UTC. El detalle permite filtrar fechas y paginar resultados. Pruebas manuales de un monitor no alteran estadísticas.

Las páginas públicas muestran únicamente los monitores seleccionados explícitamente, dentro del proyecto y los grupos elegidos. Elegir grupos filtra las opciones; no seleccionar grupos permite elegir monitores de todo el proyecto. Los monitores nuevos requieren selección manual. La migración convierte las páginas existentes a selección explícita y conserva los monitores que ya mostraban. El visitante puede elegir 90 días, 7 días (predeterminado) o 24 horas de historial. Los segmentos diarios y horarios usan UTC y excluyen pausas, mantenimiento y períodos sin datos. Los agregados horarios comienzan a generarse tras desplegar la migración `0002_public_history.sql`, sin reconstruir registros anteriores; se conservan 8 días. La vista de 7 días usa 168 segmentos horarios; la de 24 horas usa 288 segmentos de 5 minutos. Los colores de estas vistas indican la proporción de tiempo operativo, interrumpido y sin observación. Los agregados de 5 minutos comienzan tras desplegar `0003_detailed_history.sql` y se conservan 48 horas, sin inventar detalle para los registros anteriores. Los agregados diarios mantienen su retención de 365 días. Las respuestas públicas nunca incluyen destinos, credenciales ni diagnósticos privados.

Las notificaciones persisten y tienen reservas, espera creciente y hasta ocho intentos; fallos definitivos visibles en overview. Una respuesta perdida de Postmark puede repetir un correo. El entorno local marca los envíos interceptados sin llamar a Postmark.

La medición local de SQLite con 100000 filas, diagnósticos sanitizados e índices resultó en aproximadamente 339 bytes por resultado y una proyección de 8.36 GiB para 184 días. Es una estimación: no incluye variaciones de ocupación, agregados y espacio temporal de operación de D1.

100 monitores/minuto generan 144000 resultados/día y aproximadamente 26 millones en seis meses, además de índices. Revisar almacenamiento real de D1 y cuotas/costos de Workers, Queues y D1; la simulación valida programación y persistencia, no equivale a una prueba de carga de producción ni garantiza consumo bajo cuotas gratuitas.

## Migraciones y recuperación

Agregar migraciones numeradas nuevas; no editar migraciones ya aplicadas. Deben seguir siendo compatibles con el Worker todavía activo: agregar tablas/columnas antes de usarlas y posponer eliminaciones hasta que todas las versiones anteriores dejen de necesitarlas. Un fallo de migración impide publicar; las migraciones anteriores ya aplicadas pueden permanecer.

Para recuperar una versión anterior, usar el historial de versiones/despliegues de Workers en Cloudflare y seleccionar una versión previamente sana. Un rollback del Worker no revierte D1 ni secretos. Verificar compatibilidad del esquema y la llave antes de restaurar. Ante una modificación destructiva, recuperar D1 con Time Travel dentro de su ventana disponible y evaluar pérdida de datos posteriores; no ejecutar restauraciones durante incidentes sin revisar el punto elegido.

## Verificación posterior al primer despliegue

1. Confirmar dominio y TLS, redirección de raíz, OTP del propietario y rechazo de otros correos. Verificar que público y heartbeat funcionan sin Access y que los endpoints administrativos permanecen protegidos.
2. Crear un monitor de prueba y observar cron reciente, cola sin atraso y resultados. Simular dos fallos y un éxito; confirmar incidente y recuperación y correos reales solo al propietario.
3. Crear heartbeat, reportar éxito, dejar vencer intervalo/tolerancia, verificar ausencia y recuperar con otro reporte. Regenerar token y confirmar rechazo del anterior.
4. Comprobar pausa, mantenimiento, exclusiones públicas, credenciales redactadas y filtros/paginación. Revisar fallos de notificación y almacenamiento en Cloudflare.
5. Confirmar que un push a `develop` no ejecuta workflows y que producción valida y publica únicamente desde `main`. Revisar logs de Actions: validaciones y migraciones deben preceder a publicación.

Estas verificaciones externas quedan pendientes del primer despliegue. No se hicieron correos reales ni pruebas contra infraestructura de producción.
