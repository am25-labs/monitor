# @am25/monitor

Install and maintain [Monitor by AM25](https://github.com/am25-labs/monitor) in your own Cloudflare account. The public package contains the compiled application; no source checkout, GitHub account, or local application build is needed.

```sh
pnpm dlx @am25/monitor init .
pnpm dlx @am25/monitor deploy
pnpm dlx @am25/monitor doctor
pnpm dlx @am25/monitor@latest update
```

Requires Node.js 22.14+ and pnpm 10.23+. `init` accepts a destination. Other commands use the current installation directory and accept `--cwd /path/to/installation`. Use `--language es` or `--language en` to select the wizard language.

You need an active Cloudflare DNS zone, a dedicated hostname, Zero Trust and an API token with installation permissions. The wizard guides missing Zero Trust onboarding and token creation. Credentials for Cloudflare are separate from credentials configured in an optional coding agent.

Back up `.monitor/secrets.json` securely. It contains the encryption key needed to recover your monitor credentials. Never commit `.monitor/`, share its files in issues, or replace the encryption key when reusing a database.

`init . --adopt` backs up and deploys to a compatible existing installation, preserving its resources and original encryption key. The wizard verifies Access, bindings, matching migrations, published npm metadata and the key against existing encrypted data. It accepts installations without prior release markers and requires no GitHub variables or previous pipeline deployment. GitHub checks source and publishes packages; deployments are managed locally by the CLI.

Updates are explicit, back up D1 first, and preserve installation resources. They do not support downgrades or incompatible version jumps. A D1 export does not back up Durable Objects. Failed migrations are not automatically reversed.

Cloudflare Free can be used within its quotas. The number of supported monitors depends on their intervals, retention, traffic and other applications sharing the account; 100 monitors checked every minute are not promised on Free.

[Español: instalación y recuperación](https://github.com/am25-labs/monitor/blob/main/docs/cli/es.md) · [English: installation and recovery](https://github.com/am25-labs/monitor/blob/main/docs/cli/en.md)

Published exclusively by GitHub Actions with npm provenance. Source code is available under Apache-2.0. External pull requests are not accepted.
