# Set up AM25 Monitor

[Español](es.md) · [Introduction](../../README.md)

This guide installs AM25 Monitor in your Cloudflare account using GitHub Actions. Examples use `monitor.example.com` and `owner@example.com`: replace them with your own values. Do not copy the AM25 installation identifiers that may be present in the repository configuration.

## 1. Prepare accounts and domain

You need a GitHub account with Actions enabled, a Cloudflare account with Workers, D1, Queues, and Zero Trust available, and a domain whose DNS zone is active in the same Cloudflare account.

Choose a dedicated subdomain, such as `monitor.example.com`, that does not serve another application. You do not need a VPS to host Monitor. For the local steps, install Git, Node.js 22.14 or later, and the pnpm version specified in `package.json`.

Review limits and usage before choosing your plan. At one-minute intervals, 100 monitors produce around 144,000 checks per day and around 26 million over six months, plus indexes and aggregates. See the [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

## 2. Prepare your repository and choose a version

Create a fork or your own repository containing the project code, public or private. For a specific version, obtain the code from its `vX.Y.Z` tag or download its archive from [Releases](https://github.com/am25-labs/monitor/releases). Prepare that version on a branch in your repository before moving it to `main`; do not mix files from different Releases.

Clone your repository and enter its folder. Install dependencies:

```sh
pnpm install --frozen-lockfile
```

Make the following changes on a working branch, such as `develop`. Enable GitHub Actions in your fork if disabled. Keep `.github/workflows/deploy.yml`; do not also connect Workers Builds, as that would deploy through two pipelines.

## 3. Create D1 and the queue

In Cloudflare, select the account that will host the app and save its **Account ID**. Use the account ID, not the zone ID.

1. Open **Storage & databases → D1** and create a database, such as `my-monitor`. Save its name and **Database ID**.
2. Open **Queues** and create a queue, such as `my-monitor-checks`. Save its name.
3. Choose the Worker name, such as `my-monitor`. The first deployment will create it; you do not need to publish an empty Worker.

Do not create tables manually. The pipeline will apply the migrations in `migrations/`.

## 4. Protect the dashboard with Access

In **Zero Trust**, complete your organization setup and save its team domain, such as `https://my-team.cloudflareaccess.com`.

1. In identity providers, enable **One-time PIN** to sign in with a code sent by email.
2. Open **Access → Applications**, add a **Self-hosted** application, and name it `Monitor dashboard`.
3. Add entries with the same hostname, `monitor.example.com`, for these paths:

   | Protected paths |
   | --- |
   | `/app` |
   | `/app/*` |
   | `/api/v1/admin` |
   | `/api/v1/admin/*` |

4. Add an **Allow** policy with **Include → Emails** and the email you will use to sign in. Select One-time PIN as the login method.
5. Save the application and copy its **Application Audience (AUD) Tag**.

Use one application with those entries when possible, to share the audience and session. If you use separate applications, copy all their audiences into `ACCESS_AUDIENCES`, separated by commas.

Do not protect the entire hostname or use protection across the whole Worker: public pages and heartbeats must remain accessible without a session. Leave `/status/*`, `/api/v1/public/*`, `/api/v1/heartbeats/*`, `/assets/*`, and Cloudflare endpoints `/cdn-cgi/access/*` outside the rules. Access checks the policy; the Worker also validates the JWT and allows a single configured email.

See the official guides for [Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

## 5. Configure the Worker and domain

Edit `wrangler.jsonc`, replacing the original installation values:

| Field | Your value |
| --- | --- |
| `name` | Your chosen Worker name |
| `account_id` | Your Account ID |
| `routes[0].pattern` | `monitor.example.com`, without protocol or path |
| `routes[0].custom_domain` | `true` |
| `vars.ENVIRONMENT` | `production` |
| `vars.ACCESS_TEAM_DOMAIN` | Team HTTPS URL, without a trailing slash |
| `vars.ACCESS_AUDIENCES` | Access AUD; multiple audiences separated by commas |
| `vars.APP_ORIGIN` | `https://monitor.example.com`, without a trailing slash |
| `d1_databases[0].database_name` | Your database name |
| `d1_databases[0].database_id` | Your Database ID |
| `queues.producers[0].queue` | Your queue name |
| `queues.consumers[0].queue` | The same queue name |

Keep the `DB`, `CHECKS`, and `ASSETS` bindings, `migrations_dir`, `run_worker_first`, the every-minute cron, and consumer limits. Keep `workers_dev` and `preview_urls` set to `false`. Do not add your email to `vars`: `ACCESS_EMAIL` is supplied from GitHub.

The Custom Domain is connected during deployment. Cloudflare manages its DNS and certificate; you do not need to point it to your VPS IP address. If that hostname already has a CNAME, resolve the conflict before publishing, without affecting other services' records. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

The current script reads this file as JSON: do not add comments or trailing commas even though its extension is `.jsonc`.

## 6. Create the Cloudflare token

In your Cloudflare profile, open **API Tokens → Create Token → Custom token**. Limit resources to your account and the chosen domain zone. Configure edit permissions for **Workers Scripts**, **D1**, and **Queues** in the account, and **Workers Routes** and **DNS** in the zone.

Save the token when creating it. Do not use the Global API Key. This pipeline does not create Access policies: you configure them in step 4, without granting it permission to manage them.

## 7. Configure GitHub Actions

In your repository, open **Settings → Secrets and variables → Actions**.

Under **Secrets → New repository secret**, create:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The same account as in `wrangler.jsonc` |
| `CLOUDFLARE_API_TOKEN` | The token from the previous step |
| `MONITOR_CONFIG_KEY` | A random 32-byte hexadecimal key: 64 characters |

Generate the key on your computer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep a secure backup of this key. It encrypts credentials and notification settings: replacing it without migrating data makes existing values impossible to decrypt.

Under **Variables → New repository variable**, create:

| Variable | Value |
| --- | --- |
| `ACCESS_EMAIL` | The same email authorized in the Access Allow policy |

GitHub variables are not secrets and are not automatically masked. The email stays outside versioned code; in Cloudflare it is installed as Worker Secret `ACCESS_EMAIL`, alongside `CONFIG_KEY`. If missing or incorrectly formatted, deployment stops before running migrations.

Do not configure Postmark or Telegram tokens in GitHub. They are saved through the dashboard, encrypted in D1. Local `.dev.vars` values do not configure production.

## 8. Publish for the first time

Review your values and move the changes to `main` in your repository. That push triggers **Actions → Deploy production**. Pushes to `develop`, pull requests, tags, and creating Releases do not trigger deployment.

The workflow installs with the lockfile, checks TypeScript, runs tests, builds the interface, applies D1 migrations, and deploys the Worker, assets, and secrets. An error stops subsequent steps; a failed migration prevents publishing the Worker. Deployments run sequentially.

Wait for Actions to finish successfully. In Cloudflare, check that your Worker has its Custom Domain, cron, database, and queue attached. Open `https://monitor.example.com/app/`, sign in with the authorized email, and confirm the overview shows a recent engine execution.

## 9. Enable notifications

Open **Settings → Notifications** and save one global channel:

- **Email:** create a server in Postmark, verify the sender or its domain, and copy its **Server API Token**. Configure token, recipient, verified sender, and transactional stream (usually `outbound`). The recipient may differ from the Access email.
- **Telegram:** create a bot with BotFather, copy its token, and start a conversation with the bot. Obtain your personal chat's numeric ID and configure the token and ID. See the [Telegram tutorial](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).

Alerts are personal and are sent on incident opening and recovery, without client subscriptions. Until a channel is saved, notifications are not delivered; pending attempts follow the retry policy and may ultimately fail. Review their states in the overview.

In **Settings → General**, choose the dashboard language. Spanish is the default; each public page configures its language separately.

## 10. Add services and check the installation

1. Create a project and, if needed, groups.
2. For a website or API, create an HTTP monitor with its final URL or a `/health` endpoint. Start with GET and 2xx. Enable following redirects if the target returns 301, 302, or 307 and you want to check the final response.
3. For a port accessible from Workers, use TCP. It only checks the connection; it does not validate the protocol.
4. For a background process, create a heartbeat. Save the token when creating it and configure the process to send periodic POST requests:

   ```sh
   curl -X POST 'https://monitor.example.com/api/v1/heartbeats/MONITOR_ID' \
     -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
     -H 'Content-Type: application/json' \
     --data '{"ok":true}'
   ```

   Set `HEARTBEAT_TOKEN` in the process environment and replace `MONITOR_ID`. Use `{"ok":false}` to report a failure. The interval and tolerance must match its actual execution.

5. Wait for the first checks. Simulate two failures and a recovery on a test service; verify the incident and notifications to the configured recipient.
6. Create a public page: select project, groups if applicable, monitors to include, and language. Open it in a window without a session to confirm it shows only your selected services.
7. Check that the dashboard requires access, another email cannot sign in, and heartbeats do not require an Access session.

Availability excludes pauses, maintenance, and periods without data. In the 24-hour view, each segment represents 5 minutes; in the 7-day view, one hour: green without interruptions, red for any interruption, and gray without records. In the 90-day view, each segment represents one day; yellow means partial availability and red means downtime throughout the observed period.

## 11. Sign out or change the access email

Use **Sign out** next to the controls in the dashboard header. It opens the Access logout endpoint; it does not delete monitors, history, or settings. This logout also revokes the Access session for other applications in the same organization. See [session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

To change the email:

1. Add the new email to **Include → Emails** in your Access application's Allow policy.
2. Change the GitHub variable `ACCESS_EMAIL` to the new email.
3. Rerun the deployment job of a previous push to `main` from Actions, or publish your next change to `main`. Editing a variable alone does not deploy.
4. Sign out and sign in with the new email; remove the previous one from the policy after checking access.

The Worker only allows the email in the most recently deployed configuration. Changing it does not change the alert recipient.

## 12. Update, choose a version, and recover

Before updating, read the Release notes and preserve your IDs, domain, configuration, and secrets. Bring the chosen version's code into a working branch, preserve your installation changes, and promote it to `main`. The pipeline will apply pending migrations. Do not edit migrations already applied.

For the original project, each promotion to `main` will carry the version in `package.json` and be published as a Release with a matching `vX.Y.Z` tag. That publication identifies the code; it is not a second deployment trigger and the current workflow does not generate a Release automatically.

For quick recovery, you can select a previous healthy deployment from the Worker's history. This does not revert D1 or automatically restore secrets. Check the version's compatibility with the current schema and encryption key; an older version may require a separate database or data recovery. Consult [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) before restoring data.

## 13. Test locally and troubleshoot

For an isolated local installation:

```sh
pnpm db:local
pnpm dev
```

Open `http://localhost:5173/app/`. `pnpm dev` creates `.dev.vars` from the example if it does not exist. The database, queue, and access are local; email and Telegram are intercepted. HTTP/TCP targets still receive checks: use test services. Sign out is hidden because there is no Access session.

The local cron is triggered manually and validation does not require a production build:

```sh
curl http://localhost:8787/__scheduled
pnpm check
```

Do not use `wrangler.jsonc` or remote migrations for routine development. `pnpm deploy` requires a push to `main` within GitHub Actions.

| Problem | What to check |
| --- | --- |
| Actions does not run | Actions enabled and a push to `main` |
| Permission failure | Account, zone, and token permissions |
| Migration failure | Actions logs and D1 state; do not skip the migration |
| Access rejects or repeats login | Paths, policy email, `ACCESS_EMAIL`, AUD, team domain, and `APP_ORIGIN` |
| Public page or heartbeat requires login | Avoid Access rules across the whole hostname or Worker |
| Alerts do not arrive | Saved channel, credentials, sender/chat, and delivery states |
| Monitor pending or without data | Latest cron, overdue jobs, and queue configuration |
| Website marked down with 3xx | Final URL, redirects, and accepted codes |

Cloudflare menu names may change. Official links complement this guide; the repository configuration determines how this version deploys.
