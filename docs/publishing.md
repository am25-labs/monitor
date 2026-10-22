# Publicar @am25/monitor con provenance

[Español](#español) · [English](#english)

## Español

La aplicación y CLI son código abierto bajo Apache-2.0. `private: true` en el paquete raíz evita publicarlo en npm; el paquete público es `packages/cli`, con nombre `@am25/monitor`.

### Preparar una versión

1. Actualizá manualmente las versiones de ambos `package.json` para que coincidan. No uses comandos que creen commits o etiquetas automáticamente.
2. Declará en `packages/cli/compatibility.json` las versiones desde las que se admite actualizar. Cada patch debe incluir el patch inmediatamente anterior; la Action lo comprueba antes de instalar dependencias o publicar. Toda migración nueva debe ser compatible con el Worker anterior mientras sigue atendiendo solicitudes. No reescribas migraciones publicadas.
3. Revisá licencias y avisos de terceros al cambiar dependencias y ejecutá las comprobaciones del repositorio.
4. El propietario crea el commit, la etiqueta estable `X.Y.Z` y el GitHub Release correspondiente. El repositorio debe ser público antes de publicar con provenance. La Action no crea commits, etiquetas ni Releases.

Un Release estable activa `.github/workflows/publish.yml`. No publica desde pushes, pull requests, borradores, prereleases ni forks. Las publicaciones se serializan.

### Autenticación de npm

Podés reutilizar tu token existente de AM25 si permite publicar `@am25/monitor`. Guardalo como secreto `NPM_BOOTSTRAP_TOKEN` en GitHub Actions, que es el nombre que espera el workflow. No necesitás crear otro token ni configurar Trusted Publishing. El token puede seguir utilizándose para las siguientes publicaciones.

El job usa un runner hospedado por GitHub, `contents: read`, `id-token: write`, Node 24 y npm 11.5.1. El token autentica la publicación; GitHub Actions proporciona la identidad necesaria para provenance. La credencial de npm solo se entrega al paso de publicación. No requiere secretos de Cloudflare.

Trusted Publishing es opcional. Si después querés utilizarlo, configurá en npm organización `am25-labs`, repositorio `monitor`, workflow `publish.yml` y permiso para `npm publish`. El workflow también admite esa autenticación sin token.

### Artefacto y comprobaciones

La Action valida repositorio, evento, etiqueta y versiones; ejecuta `pnpm check`; compila frontend y Worker; y crea un paquete con runtime y hashes. Usa configuración genérica sin identificadores personales de AM25.

Instala el tarball en una carpeta temporal sin código fuente de la aplicación y verifica que Wrangler procese el runtime con `--no-bundle --dry-run`. Publica ese mismo tarball mediante `npm publish --provenance --access public --ignore-scripts` y conserva el artefacto y checksum en GitHub Actions.

El workflow termina cuando `npm publish --provenance` confirma la publicación. npm genera y adjunta provenance durante ese paso; no se ejecuta una consulta posterior automática al registro. Si la publicación devuelve un error, revisá npm antes de actuar y no intentes republicar una versión existente.

La compilación, el empaquetado oficial y la publicación están restringidos a GitHub Actions. Localmente se prueban runtimes sintéticos. Los scripts de release rechazan ejecuciones fuera del entorno de publicación.

La publicación exige `--provenance` e `id-token: write`. Su generación real depende de npm y GitHub Actions; las pruebas locales no certifican una publicación. Referencias: [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) y [provenance](https://docs.npmjs.com/generating-provenance-statements/).

### Publicación frente a despliegue

Publicar el paquete no despliega ninguna instancia. Los pushes a `main` no ejecutan Actions; las verificaciones se ejecutan manualmente o al publicar un Release. AM25 y los usuarios adoptan y administran sus instancias mediante la CLI desde sus computadoras. La adopción respalda y despliega sobre los mismos recursos sin variables de GitHub ni secretos de Cloudflare en Actions. Los secretos anteriores pueden permanecer sin uso; no requieren cambios para adoptar.

## English

The application and CLI are open source under Apache-2.0. `private: true` in the root package prevents publishing it to npm; the public package is `packages/cli`, named `@am25/monitor`.

### Prepare a release

1. Manually update the versions in both `package.json` files so they match. Do not use commands that automatically create commits or tags.
2. Declare supported upgrade sources in `packages/cli/compatibility.json`. Each patch must include the immediately preceding patch; the Action checks this before installing dependencies or publishing. Every new migration must remain compatible with the previous Worker while it continues serving requests. Do not rewrite published migrations.
3. Review licenses and third-party notices when changing dependencies and run the repository checks.
4. The owner creates the commit, stable `X.Y.Z` tag and corresponding GitHub Release. The repository must be public before publishing with provenance. The Action does not create commits, tags or Releases.

A stable Release triggers `.github/workflows/publish.yml`. It does not publish from pushes, pull requests, drafts, prereleases or forks. Publications run sequentially.

### npm authentication

You can reuse your existing AM25 token if it allows publishing `@am25/monitor`. Store it as the GitHub Actions secret `NPM_BOOTSTRAP_TOKEN`, the name expected by the workflow. You do not need another token or Trusted Publishing setup. The token can continue to be used for subsequent publications.

The job uses a GitHub-hosted runner, `contents: read`, `id-token: write`, Node 24 and npm 11.5.1. The token authenticates publishing; GitHub Actions supplies the identity required for provenance. The npm credential is only passed to the publishing step. No Cloudflare secrets are required.

Trusted Publishing is optional. If you want to use it later, configure npm with organization `am25-labs`, repository `monitor`, workflow `publish.yml` and permission for `npm publish`. The workflow also supports this authentication without a token.

### Artifact and checks

The Action validates the repository, event, tag and versions; runs `pnpm check`; builds the frontend and Worker; and creates a package with the runtime and hashes. It uses generic configuration without AM25's personal identifiers.

It installs the tarball in a temporary directory without application source code and checks that Wrangler processes the runtime with `--no-bundle --dry-run`. It publishes that same tarball with `npm publish --provenance --access public --ignore-scripts` and retains the artifact and checksum in GitHub Actions.

The workflow ends when `npm publish --provenance` confirms publication. npm generates and attaches provenance during that step; no subsequent automated registry query runs. If publishing returns an error, check npm before acting and do not attempt to republish an existing version.

Compilation, official packaging and publishing are restricted to GitHub Actions. Synthetic runtimes are tested locally. Release scripts reject execution outside the publishing environment.

Publishing requires `--provenance` and `id-token: write`. Actual generation depends on npm and GitHub Actions; local tests do not certify a publication. References: [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [provenance](https://docs.npmjs.com/generating-provenance-statements/).

### Publishing versus deployment

Publishing the package does not deploy any installation. Pushes to `main` do not trigger Actions; checks run manually or when publishing a Release. AM25 and users adopt and manage their installations through the CLI from their computers. Adoption backs up and deploys using the same resources without GitHub variables or Cloudflare secrets in Actions. Previous secrets can remain unused; they do not need to change for adoption.
