# Install Monitor with the CLI

[Español](es.md) · [Package publishing](../publishing.md) · [Free validation](../free-plan.md)

Requires Node.js 22.14+, pnpm 10.23+, a Cloudflare account and a domain with an active DNS zone in that account. Choose a dedicated hostname without existing DNS records. No GitHub account, source checkout, agent or local application build is needed.

```sh
mkdir my-monitor
cd my-monitor
pnpm dlx @am25/monitor init . --language en
```

Select your account, zone, hostname, Worker name and owner email. Configure alert channels later in the dashboard; notification recipients can differ from the sign-in email.

## Authentication

Create a custom API token scoped to the selected account and zone. Grant edit permissions for Workers Scripts, D1, Queues, Access: Apps and Policies, Access: Organizations, Identity Providers, and Groups, and zone Workers Routes and DNS. Include Account Settings and zone read permissions for discovery.

Enter the token in the hidden prompt or provide `CLOUDFLARE_API_TOKEN` through your secret manager. Do not pass secrets as arguments or use the Global API Key. The CLI does not store the token or reuse agent credentials. Resource visibility is checked before provisioning; read access alone does not prove write access, which is enforced by each API operation.

If Zero Trust is missing, the wizard guides onboarding and checks again when you confirm completion. Cloudflare may request a plan and payment details. The CLI does not subscribe to services or change plans. It creates or reuses One-time PIN and protects only `/app`, `/app/*`, `/api/v1/admin` and `/api/v1/admin/*`.

## Files and commands

`.monitor/` contains configuration, separate secrets, release caches and backups, and is excluded from Git. Back up `.monitor/secrets.json` securely. Its `CONFIG_KEY` is required to decrypt stored credentials and must be preserved when reusing a database. The Cloudflare token is not stored there. Do not modify cached releases.

```sh
pnpm dlx @am25/monitor deploy
pnpm dlx @am25/monitor doctor
pnpm dlx @am25/monitor@latest update
pnpm dlx @am25/monitor@X.Y.Z update
```

Only `init` accepts a positional destination. Other commands use the current installation and accept `--cwd /path/to/installation`. `deploy` uses the installed version. `update` uses the invoked CLI's bundled release. Releases explicitly declare supported upgrade sources. Downgrades, incompatible jumps and changed historical migrations are rejected.

## Resume and recover

Repeat the same command using the same CLI version. Keep the directory and original encryption key. Existing installations are backed up before migrations into `.monitor/backups/`, including configuration, secrets and a D1 export. A failed backup stops deployment; resuming retains the original backup even after partial migrations.

An unconfirmed creation is recorded as `pending` and never blindly repeated. Reconcile the resource type and recorded names with Cloudflare. Only after positively identifying the created resource, record its actual ID in `resources` and remove `pending`. If you confirmed nothing was created, remove only `pending`. Do not adopt shared resources or delete unrelated resources.

After an abrupt termination, verify the process in `.monitor/operation.lock` has stopped before removing that file. Run one CLI at a time per installation; do not run deployments simultaneously from copies on different machines.

There is no automatic schema rollback. Preserve backups and follow release recovery instructions before manually restoring a failed migration. Restoring D1 can discard subsequent data and does not restore Durable Objects. Reverting Worker code does not revert migrations. Never delete namespaces as a recovery shortcut.

## Adopt an existing installation

From a new directory on your Mac, run:

```sh
pnpm dlx @am25/monitor init . --adopt
```

The wizard asks for the original `wrangler.jsonc` path, owner email and original production encryption key through hidden input. Enter your Cloudflare token in the wizard. No GitHub variables or previous pipeline deployment are required.

Adoption verifies resources, Access, the published package/provenance metadata, matching migration names and the key against existing encrypted data. Existing installations without release markers are accepted. If there is no encrypted sample, confirm the original backed-up key.

After confirmation, it backs up configuration, secrets and D1, and deploys the CLI release using the same Worker, database, queue, domain and namespaces. It marks adoption complete only after verifying publication. Repeat the same command and CLI version after failure to resume without repeating questions or replacing the original backup.

GitHub now checks source and publishes npm packages; it does not deploy your instance or require Cloudflare secrets. Old GitHub secrets can remain unused and do not need to be changed for adoption. Manage the installation locally using `deploy`, `update` and `doctor` afterward.

Standard configuration with one Access application and One-time PIN is required. Customized installations require manual reconciliation rather than silently replacing settings.

## Diagnosis

`doctor` makes read-only remote requests to inspect integrity, resources, Access, domain, cron, migrations, engine activity and unauthenticated HTTP responses. A new installation may need a few minutes before its first engine cycle is observed. Owner sign-in and a real status page still need human verification. It does not create monitors, send alerts or submit heartbeats, and does not certify workload capacity on Free.
