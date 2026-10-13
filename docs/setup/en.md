# Set up AM25 Monitor

[Español](es.md) · [Introduction](../../README.md)

This guide installs AM25 Monitor in your Cloudflare account using GitHub Actions. Examples use `monitor.example.com` and `owner@example.com`: replace them with your own values. Do not copy the AM25 installation identifiers that may be present in the repository configuration.

## Agent-assisted installation (optional)

You can follow this guide with your preferred coding agent. We recommend installing its Cloudflare plugin or connecting a compatible official MCP server and authenticating it with your account. See [Cloudflare's official connection options](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/). Installation depends on the agent; this option does not require Codex.

Open the repository in your agent, connect Cloudflare, and copy the following prompt. The agent must ask for your values and check its tools and permissions: some connectors only query documentation or cannot manage Access. Authenticating the plugin does not automatically configure the GitHub pipeline credentials either.

```text
Help me install AM25 Monitor in my own account following docs/setup/en.md.
First read the repository instructions, the entire guide, and the current
configuration. Do not reuse IDs, domains, or emails from the original installation.

Before changing resources, ask me for any missing information:
- GitHub repository and local folder where we will work.
- Version X.Y.Z I want to install, without a v prefix, and working branch.
- Cloudflare account: help me identify its name and Account ID.
- DNS zone and dedicated Monitor hostname; verify that the zone is active.
- Email I will authorize for sign-in; do not assume it is the alert recipient.
- Names for the Worker, D1, queue, and Access application, or whether I want to
  reuse existing resources dedicated to this installation.
- Whether I already have a Zero Trust organization and One-time PIN configured.
- Notification channels (Postmark, Telegram, Pushover, or ntfy) and the non-secret details required
  to configure it, if I want to enable it during installation.

Use the authenticated Cloudflare plugin or MCP. Check the selected account,
permissions, and available operations before acting. Consult current official
documentation for Cloudflare steps. Show me the resources you will create or reuse
and confirm the target account and domain with me. Do not delete or modify shared
resources or resources belonging to other services. If there is a DNS conflict or
another destructive change, explain it and request specific authorization.

Using my values, complete the guide steps supported by your tools:
1. Create or identify D1 and the queue for this installation.
2. Prepare Zero Trust and One-time PIN. If I must complete a plan, subscription,
   or authorization wizard, guide me and wait until I finish.
3. Create the Access application with the four private paths in the guide and an
   Allow / Include / Emails policy with my email. Keep status and heartbeat paths
   public. If it already exists, verify its configuration without duplicating it.
4. Obtain the actual team domain and AUDs. Update wrangler.jsonc with my resources
   and Custom Domain; preserve bindings, cron, and security configuration.
5. Help me configure the four GitHub Repository secrets:
   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, MONITOR_CONFIG_KEY, and ACCESS_EMAIL.
   ACCESS_EMAIL must match the Access policy and must not be stored in files.
   Use secure secret input or tell me where to paste them myself; do not ask for
   tokens or the key in chat and do not print them in logs, versioned files, or
   reports. Explain how to generate and back up the encryption key.
   The plugin token does not replace the GitHub Actions deployment token.
6. Verify changes with pnpm check and review the diff. Do not run a local
   production build or remote migrations as development validation.
7. Give me a summary of configured resources and remaining steps. Do not stage,
   commit, push, promote to main, or create Releases for me.
   I will publish to main so GitHub Actions can migrate and deploy.
8. After I confirm deployment, verify the domain, private access, public page,
   cron, and heartbeat. Help me save the alert channel in the dashboard through
   secure input. Ask for authorization before causing test outages or sending
   real notifications to the recipient I specify.

If a tool or permission is missing, do not claim the step is complete: tell me
which operation is pending and guide me through the exact screens to do it manually.
Do not change accounts, plans, or deployment methods without consulting me. Preserve
the same key when reusing encrypted data. Omit my real email and secrets from the
final report. Distinguish what is configured, verified, and pending.
```

The agent can help prepare the entire installation, but plan selection, account authorizations, and operations unsupported by the connector require your involvement. The numbered steps below remain the reference for manual installation and reviewing the agent's work.

## 1. Prepare accounts and domain

You need a GitHub account with Actions enabled, a Cloudflare account with Workers, Durable Objects, D1, Queues, and Zero Trust available, and a domain whose DNS zone is active in the same Cloudflare account.

Choose a dedicated subdomain, such as `monitor.example.com`, that does not serve another application. You do not need a VPS to host Monitor. For the local steps, install Git, Node.js 22.14 or later, and the pnpm version specified in `package.json`.

Review limits and usage before choosing your plan. At one-minute intervals, 100 monitors produce around 144,000 checks per day and around 26 million over six months, plus indexes and aggregates. See the [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

## 2. Prepare your repository and choose a version

Create a fork or your own repository containing the project code, public or private. For a specific version, obtain the code from its `X.Y.Z` tag or download its archive from [Releases](https://github.com/am25-labs/monitor/releases). Prepare that version on a branch in your repository before moving it to `main`; do not mix files from different Releases.

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

Complete this step before the first deployment. The pipeline creates the Worker, but it does not create the Zero Trust organization, the sign-in method, or the Access policy.

**Zero Trust** is Cloudflare's security dashboard. **Access** is the service within that dashboard that displays the dashboard sign-in page. An **application** specifies which domain and paths to protect; an **Allow policy** specifies which email can sign in. These resources are configured in Cloudflare, not in GitHub or on your VPS.

### 4.1. Open Zero Trust and prepare the organization

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) and sign in.
2. Select the same account where you created D1 and the queue in step 3. If you have multiple accounts, check the name and Account ID before continuing.
3. In that account's menu, open **Zero Trust**. You can also open the [Cloudflare One dashboard](https://one.dash.cloudflare.com/) and select that account.
4. If a welcome wizard appears, create your organization: choose a team name, select the appropriate plan, and complete the subscription details requested by Cloudflare. The wizard may request payment details even for the free plan.
5. If the Zero Trust dashboard already appears, use the existing organization; you do not need to create another one.
6. In **Zero Trust → Settings**, identify the team name. Save its full URL, such as `https://my-team.cloudflareaccess.com`: this will be the value of `ACCESS_TEAM_DOMAIN`. It is not Monitor's public domain.

You should now be able to open the Zero Trust dashboard and know your team domain. See [Zero Trust initial setup](https://developers.cloudflare.com/cloudflare-one/setup/).

### 4.2. Enable email sign-in

1. Within Zero Trust, open **Integrations → Identity providers**.
2. Under **Your identity providers**, select **Add new identity provider**.
3. Choose **One-time PIN** and complete its creation. If already listed, reuse it.

One-time PIN sends a code to the authorized email when you try to enter the dashboard. New organizations may have the Cloudflare provider as the default; that does not mean One-time PIN is already active. This method does not require Postmark configuration: Monitor's alerts are configured separately. See [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

### 4.3. Create the dashboard application

1. Within Zero Trust, open **Access controls → Applications**. Older interfaces may display **Access → Applications**.
2. Select **Create new application** or **Add an application**, depending on the interface.
3. Choose **Self-hosted and private** (or **Self-hosted**) and name it `Monitor dashboard`.
4. Use **Add public hostname** to add your chosen domain, such as `monitor.example.com`, with each of these paths. All must belong to this application:

   | Hostname | Path |
   | --- | --- |
   | `monitor.example.com` | `/app` |
   | `monitor.example.com` | `/app/*` |
   | `monitor.example.com` | `/api/v1/admin` |
   | `monitor.example.com` | `/api/v1/admin/*` |

   If Cloudflare splits the hostname into fields, use `monitor` as the subdomain and `example.com` as the domain. The Path field contains the path; do not enter a full URL there.

5. In the application's authentication methods, select **One-time PIN**. Do not leave all providers selected if you only want to sign in using an emailed code.
6. Continue with the policy in the next section before saving the application.

Do not add an entry without a Path that protects the whole hostname or enable protection across the whole Worker. Public pages and heartbeats must work without a session. Leave `/status/*`, `/api/v1/public/*`, `/api/v1/heartbeats/*`, `/assets/*`, and `/cdn-cgi/access/*` outside these rules. See [Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

### 4.4. Authorize the email and save the audience

1. Under the application's **Access policies**, create a policy. You can name it `Monitor owner`.
2. Under **Action**, choose **Allow**.
3. Add an **Include** rule and select **Emails** as the selector.
4. Enter only the email you will use to sign in, such as `owner@example.com`. Do not choose Everyone or an entire email domain for this single-owner installation.
5. Save the policy and check that it is associated with `Monitor dashboard`. Finish saving the application.
6. Open the application's configuration or details and copy **Application Audience (AUD) Tag**. Save this value for `ACCESS_AUDIENCES`; do not copy the policy ID or application ID instead.

The same email must later be saved as the GitHub secret `ACCESS_EMAIL` in step 7. These are two distinct checks:

| Location | What to configure | Example |
| --- | --- | --- |
| Cloudflare, Access policy | **Allow → Include → Emails** | `owner@example.com` |
| GitHub, Repository secrets | **ACCESS_EMAIL** | `owner@example.com` |

Access allows entry according to the policy; the Worker also validates the JWT and checks that the email matches `ACCESS_EMAIL`. Configuring only one location does not complete the installation. The alert recipient can be a different email.

Use one application with the four paths to share the audience and session. If you already have separate applications, use the same owner policy and copy their audiences into `ACCESS_AUDIENCES`, separated by commas. See [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

Before continuing, you should have three values: the team URL, the application's AUD, and the authorized email. The application can be configured before publishing the Worker; testing sign-in belongs to step 8.

### 4.5. Find an application already configured

If Monitor already requests a code when you sign in, first find its existing configuration:

1. Open Cloudflare, select the correct account, and go to **Zero Trust → Access controls → Applications**.
2. Find `Monitor dashboard` or the application whose hostname matches your Monitor domain. Its name may differ if you chose another one during installation.
3. Open it for editing and go to **Policies / Access policies**.
4. Open the policy with the **Allow** action and review **Include → Emails**. That is where the authorized email is configured.

If you cannot see the application, check the selected account and hostname before creating another one. Step 11 explains how to change the email without losing access.

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

Keep the `DB`, `CHECKS`, `ASSETS`, and `SCHEDULER` bindings, `migrations_dir`, `run_worker_first`, the every-minute cron, and consumer limits. Keep `workers_dev` and `preview_urls` set to `false`. Do not add your email to `vars`: `ACCESS_EMAIL` is supplied from GitHub.

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
| `ACCESS_EMAIL` | The same email authorized in the Access Allow policy |

Generate the key on your computer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep a secure backup of this key. It encrypts credentials and notification settings: replacing it without migrating data makes existing values impossible to decrypt.

All four values must be in **Repository secrets**, not the Variables tab. The workflow reads `secrets.ACCESS_EMAIL`; a value saved only in Variables will not be received. The email stays outside versioned code and is installed in Cloudflare as Worker Secret `ACCESS_EMAIL`, alongside `CONFIG_KEY`. If missing or incorrectly formatted, deployment stops before running migrations.

Do not configure notification channel credentials in GitHub. They are saved through the dashboard, encrypted in D1. Local `.dev.vars` values do not configure production.

## 8. Publish for the first time

Review your values and move the changes to `main` in your repository. That push triggers **Actions → Deploy production**. Pushes to `develop`, pull requests, tags, and creating Releases do not trigger deployment.

The workflow installs with the lockfile, checks TypeScript, runs tests, builds the interface, applies D1 migrations, and deploys the Worker, assets, and secrets. An error stops subsequent steps; a failed migration prevents publishing the Worker. Deployments run sequentially.

Wait for Actions to finish successfully. In Cloudflare, check that your Worker has its Custom Domain, cron, the `SCHEDULER` binding, database, and queue attached. Open `https://monitor.example.com/app/`, sign in with the authorized email, and confirm the overview shows a recent engine execution.

## 9. Enable notifications

Open **Settings → Notifications**. Enable one or more channels and save your changes:

- **Email:** create a server in Postmark, verify the sender or its domain, and copy its **Server API Token**. Configure token, recipient, verified sender, and transactional stream (usually `outbound`). The recipient may differ from the Access email.
- **Telegram:** create a bot with BotFather, copy its token, and start a conversation with the bot. Obtain your personal chat's numeric ID and configure the token and ID. See the [Telegram tutorial](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).

- **Pushover:** install the app, create an account at [Pushover](https://pushover.net/), and register an application named AM25 Monitor. Copy its **API Token** and your **User Key** into the dashboard. When repetitions are enabled, confirmed outages use emergency priority: by default, every 60 seconds for 1800 seconds (30 minutes), until acknowledged in the app or the service recovers. Pushover limits each alert to 50 retries and a maximum of three hours. Recovery cancels pending repetitions and is sent as a normal notification. On iPhone, authorize critical alerts in Pushover and in iOS Settings; test the sound with your phone locked and your usual nighttime mode enabled. The app offers a 30-day trial and a one-time purchase per platform, without automatic billing when the trial ends. See its [pricing](https://pushover.net/pricing).
- **ntfy:** install the app and subscribe to a topic on [ntfy.sh](https://ntfy.sh/) or your own server hosted outside the monitored infrastructure. Configure the server's HTTPS URL, the same topic, and an access token if authentication is required. Free ntfy.sh topics are not private: use a long random name, such as `monitor-` followed by 32 random characters, and avoid known names. Anyone who knows the topic can read and publish messages. The free public service limits sending to 250 messages per day. Monitor sends urgent priority for outages and normal priority for recovery, without automatic repetitions. iOS critical alerts are still listed as unreleased in the [release notes](https://docs.ntfy.sh/releases/); do not rely on ntfy to bypass silent mode or Do Not Disturb on iPhone.

Alerts are personal and are sent to all enabled channels on incident opening and recovery, without client subscriptions. Each channel maintains its own deliveries and retries: a failure in one does not repeat successful sends in another. Review per-channel failures in the overview; Retry retries the failed deliveries for that event. Tokens, the user key, and the topic are stored encrypted and are not returned to the browser; leaving them blank preserves the existing value.

Previous single-channel settings are automatically preserved on upgrade. Until settings are saved, notifications are not delivered; pending attempts may ultimately fail. If you save all channels disabled, new events will not send alerts. Disabling Pushover does not immediately cancel an alarm already sent: you can acknowledge it in the app; Monitor also cancels it when processing recovery. A lost provider response may cause duplicate sends.

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

1. Find your application and its policy by following section 4.5. Add the new email to **Allow → Include → Emails** without removing the previous one yet.
2. Change the repository secret `ACCESS_EMAIL` in GitHub to the new email.
3. Rerun the deployment job of a previous push to `main` from Actions, or publish your next change to `main`. Editing a secret alone does not deploy. If rerunning a job, choose a run whose workflow already reads `secrets.ACCESS_EMAIL`: rerunning an old run does not update its workflow file.
4. Sign out and sign in with the new email; remove the previous one from the policy after checking access.

The Worker only allows the email in the most recently deployed configuration. Changing it does not change the alert recipient.

## 12. Update, choose a version, and recover

Before updating, read the Release notes and preserve your IDs, domain, configuration, and secrets. Bring the chosen version's code into a working branch, preserve your installation changes, and promote it to `main`. The pipeline will apply pending migrations. Do not edit migrations already applied.

For the original project, each promotion to `main` will carry the version in `package.json` and be published as a Release with a matching `X.Y.Z` tag. That publication identifies the code; it is not a second deployment trigger and the current workflow does not generate a Release automatically.

For quick recovery, you can select a previous healthy deployment from the Worker's history. This does not revert D1 or automatically restore secrets. Check the version's compatibility with the current schema and encryption key; an older version may require a separate database or data recovery. Consult [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) before restoring data.

The hub migration adds a delivery table without removing existing data. After saving multichannel settings, do not roll back to a version before the hub: those versions only understand one channel. Keep a version that supports the hub or adapt the encrypted settings before that kind of recovery.

## 13. Test locally and troubleshoot

For an isolated local installation:

```sh
pnpm db:local
pnpm dev
```

Open `http://localhost:5173/app/`. `pnpm dev` creates `.dev.vars` from the example if it does not exist. The database, queue, and access are local; all notification channels are intercepted. HTTP/TCP targets still receive checks: use test services. Sign out is hidden because there is no Access session.

Trigger the local cron manually to start the scheduler; alarms continue subsequent cycles. Also preserve `durable_objects` and `migrations` in Wrangler. Deployment creates the Durable Object automatically, without additional secrets. Validation does not require a production build:

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
| Monitor pending or without data | Scheduler alarms, latest cycle, overdue jobs, and queue configuration |
| Website marked down with 3xx | Final URL, redirects, and accepted codes |

Cloudflare menu names may change. Official links complement this guide; the repository configuration determines how this version deploys.
