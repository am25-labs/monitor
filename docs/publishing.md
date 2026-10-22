# Publicar @am25/monitor con provenance

La aplicación y CLI son código abierto bajo Apache-2.0. `private: true` en el paquete raíz evita publicarlo en npm; el paquete público es `packages/cli`, con nombre `@am25/monitor`.

## Preparar una versión

1. Actualizá manualmente las versiones de ambos `package.json` para que coincidan. No uses comandos que creen commits o etiquetas automáticamente.
2. Declarar en `packages/cli/compatibility.json` las versiones desde las que se admite actualizar. Toda migración nueva debe ser compatible con el Worker anterior mientras sigue atendiendo solicitudes. No reescribas migraciones publicadas.
3. Revisá licencias y avisos de terceros al cambiar dependencias y ejecutá las comprobaciones del repositorio.
4. El propietario crea el commit, la etiqueta estable `X.Y.Z` y el GitHub Release correspondiente. El repositorio debe ser público antes de publicar con provenance. La Action no crea commits, etiquetas ni Releases.

Un Release estable activa `.github/workflows/publish.yml`. No publica desde pushes, pull requests, borradores, prereleases ni forks. Las publicaciones se serializan.

## Autenticación de npm

Podés reutilizar tu token existente de AM25 si permite publicar `@am25/monitor`. Guardalo como secreto `NPM_BOOTSTRAP_TOKEN` en GitHub Actions, que es el nombre que espera el workflow. No necesitás crear otro token ni configurar Trusted Publishing. El token puede seguir utilizándose para las siguientes publicaciones.

El job usa un runner hospedado por GitHub, `contents: read`, `id-token: write`, Node 24 y npm 11.5.1. El token autentica la publicación; GitHub Actions proporciona la identidad necesaria para provenance. La credencial de npm solo se entrega al paso de publicación. No requiere secretos de Cloudflare.

Trusted Publishing es opcional. Si después querés utilizarlo, configurá en npm organización `am25-labs`, repositorio `monitor`, workflow `publish.yml` y permiso para `npm publish`. El workflow también admite esa autenticación sin token.

## Artefacto y comprobaciones

La Action valida repositorio, evento, etiqueta y versiones; ejecuta `pnpm check`; compila frontend y Worker; y crea un paquete con runtime y hashes. Usa configuración genérica sin identificadores personales de AM25.

Instala el tarball en una carpeta temporal sin código fuente de la aplicación y verifica que Wrangler procese el runtime con `--no-bundle --dry-run`. Publica ese mismo tarball mediante `npm publish --provenance --access public --ignore-scripts` y conserva el artefacto y checksum en GitHub Actions.

Después comprueba la integridad publicada y la atestación de provenance contra repositorio, commit y digest esperados. Si la verificación posterior falla, la versión podría estar publicada: revisá npm antes de actuar y no intentes republicar una versión existente.

La compilación, el empaquetado oficial y la publicación están restringidos a GitHub Actions. Localmente se prueban runtimes sintéticos. Los scripts de release rechazan ejecuciones fuera del entorno de publicación.

La primera publicación real debe completar la verificación de provenance; esto no puede certificarse con pruebas locales. Referencias: [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) y [provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Publicación frente a despliegue

Publicar el paquete no despliega ninguna instancia. Los pushes a `main` solo ejecutan verificaciones. AM25 y los usuarios adoptan y administran sus instancias mediante la CLI desde sus computadoras. La adopción respalda y despliega sobre los mismos recursos sin variables de GitHub ni secretos de Cloudflare en Actions. Los secretos anteriores pueden permanecer sin uso; no requieren cambios para adoptar.

## English

Publish only through `publish.yml`, triggered by a stable GitHub Release tagged `X.Y.Z`. Application and CLI versions must match. The owner creates commits, tags and Releases.

Reuse an existing AM25 token with permission to publish `@am25/monitor`, stored as the GitHub Actions secret `NPM_BOOTSTRAP_TOKEN`. No new token or Trusted Publishing setup is required. The token authenticates publishing while GitHub Actions supplies provenance identity. Trusted Publishing for `am25-labs/monitor`, workflow `publish.yml`, is an optional alternative. Every publication requires provenance and a public repository/package.

Pushes to `main` only check source code. Installation, adoption and deployments run locally through the CLI. Adoption backs up and deploys using existing resources, without GitHub variables or Cloudflare secrets in Actions.

The workflow builds, packs, installs and checks the exact tarball without application source, then publishes that artifact and verifies registry integrity and provenance. Declare compatible upgrade sources in `packages/cli/compatibility.json`; new migrations must remain compatible with the running previous release. Real provenance verification completes only after publishing to npm.
