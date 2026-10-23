# Install Monitor with the CLI

[Español](es.md) · [Package publishing](../publishing.md#english) · [Free validation](../free-plan.md#english)

Requires Node.js 24.22.1, pnpm 10.23+, a Cloudflare account and a domain with an active DNS zone in that account. Choose a dedicated hostname without existing DNS records. No GitHub account, source checkout, agent or local application build is needed.

The Node requirement applies to the terminal running the CLI. Check `node --version`: it must return `v24.22.1`. Installing or updating the package does not change Node automatically.

```sh
mkdir my-monitor
cd my-monitor
pnpm dlx @am25/monitor init .
```

The wizard lets you choose Spanish or English; it also accepts `--language es` and `--language en`. Select your account and zone, hostname, Worker name and owner email. Configure alert channels later in the dashboard; notification recipients can differ from the sign-in email.

## Authentication and requirements

In Cloudflare → My Profile → API Tokens → Create Token, create a custom token scoped to the selected account and zone, with these edit permissions:

- Workers Scripts, D1 and Queues.
- Access: Apps and Policies.
- Access: Organizations, Identity Providers, and Groups.
- Workers Routes and DNS for the zone.
- Account Settings and zone read access to discover the account and domain.

The CLI checks resource visibility before acting. Effective write restrictions are also checked when each operation runs; a successful read request does not guarantee all edit permissions.

Enter the token in the hidden prompt or provide it through `CLOUDFLARE_API_TOKEN`, preferably from your secret manager. Do not use the Global API Key or pass the token as an argument. The CLI does not store it or use agent credentials. If Cloudflare requires renewing the token or extending permissions, repeat the same command with the corrected token.

If Zero Trust is missing, the wizard guides onboarding and checks again when you confirm completion. Cloudflare may request a plan and payment details. The CLI does not subscribe to services or change plans. It then creates or reuses One-time PIN and creates an application protecting only `/app`, `/app/*`, `/api/v1/admin` and `/api/v1/admin/*`.

## Files and maintenance

The installation is stored in `.monitor/`, excluded from Git, with separate configuration and secrets, release caches and backups. Do not edit cached release files: their integrity is checked before use.

Back up `.monitor/secrets.json` securely. Preserve the same `CONFIG_KEY` when recovering the database: changing it prevents decrypting existing credentials. The Cloudflare token is not part of that file.

From the installation directory:

```sh
pnpm dlx @am25/monitor deploy
pnpm dlx @am25/monitor doctor
pnpm dlx @am25/monitor@latest update
```

`deploy` publishes the installed version, even when invoked through a newer CLI. `update` uses the release bundled with the invoked CLI. For a specific version:

```sh
pnpm dlx @am25/monitor@X.Y.Z update
```

Only `init` accepts a positional destination. From another location, use `--cwd /path/to/my-monitor`. Updates can skip intermediate releases without a version allowlist; downgrades are rejected. Previous migrations must retain their names and contents.

## Resume and recover

Repeat the same command using the same CLI version to resume a failed operation. Do not delete the directory or generate another key. State distinguishes applied migrations, pending publication and the deployed version.

Before migrating an existing installation, the CLI backs up configuration, secrets and D1 in `.monitor/backups/`. If the backup fails, it does not migrate or deploy. Resuming retains that backup; it does not replace it with a copy taken after a partial migration.

A remote creation without a confirmed response is recorded as `pending` and stops further attempts. Check the resource type and its names in `installation.json` against Cloudflare. Only after positively identifying the created resource, record its actual ID in `resources` and remove `pending`; if you confirmed it was not created, remove only `pending`. Do not adopt shared resources or delete resources to resolve this.

An abruptly terminated operation may leave `.monitor/operation.lock`. Verify that the recorded process has stopped before removing that file. Run only one CLI per installation and do not operate simultaneously from copies of the directory on different computers.

Migrations are not automatically reversed. If a migration is incompatible or partially fails, stop publishing, preserve backups and follow the release's recovery notes. Restoring D1 can discard data created after the backup and requires explicit intervention. D1 does not include Durable Object state; reverting code does not revert the schema either. Never delete namespaces during recovery.

## Adopt an existing installation

From a new directory on your Mac, run:

```sh
pnpm dlx @am25/monitor init . --adopt
```

The wizard asks for the original `wrangler.jsonc` path, owner email and original production encryption key through hidden input. You do not need to configure GitHub variables or run the previous pipeline again. Enter your Cloudflare token in the same wizard.

The repository's `wrangler.jsonc` contains example values. For adoption, provide your instance's actual configuration file. A local copy named `wrangler.instance.jsonc` is excluded from Git; enter its full path in the wizard.

The CLI verifies resources, Access, existing migrations and the key against encrypted data. It also verifies that the selected version is published with provenance. For adoption, the schema must match that version; installations without prior version metadata are also accepted. If there is no encrypted data, it asks you to confirm that you retain the original key.

After confirmation, it backs up configuration, secrets and D1, and deploys the CLI release using the same Worker, database, queue, domain and namespaces. It marks adoption complete only after verifying publication. If it fails, repeat the same command with the same CLI version: it reuses the backup and previously requested data.

GitHub now checks source and publishes npm packages; it does not deploy your instance or require Cloudflare secrets. Old GitHub secrets can remain unused and do not need to be changed for adoption. Manage the installation locally using `deploy`, `update` and `doctor` afterward.

Standard configuration with one Access application and One-time PIN is required. Customized installations require manual reconciliation rather than silently replacing settings.

## Diagnosis

GET requests to the Cloudflare API retry transient errors up to twice. HTTP 503 means Cloudflare could not complete the request; it does not by itself indicate missing permissions. If deployment completed and only the final diagnostics fail, run `pnpm dlx @am25/monitor@X.Y.Z doctor` with the same version to repeat checks without migrating or deploying again.

`doctor` makes only read-only remote requests. It checks local integrity, bindings, namespaces, Access, domain, cron, migrations, recent engine cycles and unauthenticated HTTP responses. A cycle not yet observed after installation may require waiting a few minutes and running it again.

Owner sign-in and checking a real status page remain human verifications. Diagnosis does not send alerts, create monitors or submit heartbeats. A successful result does not certify workload capacity or future availability of free quotas either.
