# Nozdormu

A Discord bot for an EU guild in World of Warcraft: Forever, Blizzard's "Classic+" (launches 2026-11-04). One always-on Node process holds a gateway connection through discord.js. Andy builds it alone. Work is tracked in GitHub Issues.

## Process

This section overrides Andy's global `~/.claude/CLAUDE.md` where they differ.

- Use only two Matt Pocock skills: `mattpocock-skills:tdd` and `mattpocock-skills:code-review`.
- Don't use the planning chain (`/setup-matt-pocock-skills`, `/grill-me`, `/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement`, `/triage`, `/wayfinder`) or any other Matt Pocock skill, such as `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `research` or `prototype`, unless Andy asks for it.
- Every PR description starts with its spec: 3–6 plain bullets saying what the change should do, not how, written before any code. TDD writes tests from that list, and code review checks the code against it. Link the issue with `Closes #n`.
- Work autonomously. Choose the test boundaries yourself and list them in the PR description; don't wait for Andy to agree them. Only stop for things only Andy can do (accounts, secrets, payments, running a slash command as a real user) or decisions that are genuinely his. Batch those into one short list.
- The global TypeScript standards and testing rules still apply. So do the bug-fixing rules (reproduce it first, name the cause, land a regression test), without the `diagnosing-bugs` skill.
- Track work in GitHub Issues: one issue per feature, with no labels, milestones or boards. Ideas live in the backlog issue until they're picked up.
- Use the `gh` CLI for GitHub.
- No AI attribution anywhere: no `Co-Authored-By` lines and no "Generated with Claude Code", in commits, PRs, issues or code.

## Public repo rules

The code, issues, PRs and Actions logs are all public.

- No secrets anywhere. Config comes from environment variables, validated at startup. Commit `.env.example`; `.env*` is gitignored.
- No real guild data anywhere, including test fixtures, issues and PR descriptions: no real chat, member or character names, channel names, guild Discord IDs, or screenshots. Use made-up data.
- Never log message content. Log IDs and counts instead.
- Andy keeps a private project brief outside the repo. Never commit it or copy its contents in.
- Never fetch Wowhead pages from code; Wowhead blocks it. Link to `https://www.wowhead.com/forever/item=<id>` instead. Never import data copied from Wowhead or fan sites.

## Stack

Prefer the latest versions that work together, and fast tools. The choices below are current judgement calls, not fixed.

- Node 26, pinned with `devEngines.runtime`; pnpm downloads it to run scripts, whatever Node is installed. pnpm 12, pinned with `packageManager`. Plain pnpm workspaces; no Turborepo or Nx.
- TypeScript 7 (the native compiler), strict. No build step: the code is written so Node can run the `.ts` files directly, so only erasable syntax (no enums, namespaces or parameter properties), and relative imports end in `.ts`. One root `tsconfig.json` covers every package, so a new package can't be skipped.
- Oxlint with type-aware rules for linting, run on TypeScript 7's compiler: the typescript-eslint strict type-checked set, plus exhaustive `switch` checks, consistent type imports and explicit return types on exported functions. oxfmt for formatting. No ESLint or Prettier.
- discord.js 14. Use its types and `discord-api-types` rather than hand-rolled ones.
- pino for structured logging. Code takes a `Pick<Logger, ...>` of the methods it uses, so tests can pass a typed fake.
- Vitest 5, finding `*.test.ts` files anywhere. Database tests run against real Postgres, not mocks.
- `minimumReleaseAge` in `pnpm-workspace.yaml` refuses packages published less than a day ago. Pin the previous release rather than adding an exclusion. Renovate waits 3 days before proposing an update.
- Postgres on Supabase's free plan, reached through Supabase's connection pooler. Drizzle ORM 0.45 and drizzle-kit 0.31.
- Locally, Postgres runs in DBngin, not Docker. Use the same major version as Supabase. The local server is shared with Andy's other projects, so only create, use and drop databases whose names start with `nozdormu_`.
- zod 4 for env validation. lefthook for git hooks. Renovate for dependency updates.
- Hosted on Railway Hobby. The Claude API writes the newspaper.

## Architecture

Built so far:

- `apps/bot` is the process. `src/main.ts` loads config (`loadConfig` validates the environment and names bad settings without echoing values), builds the registry from `createFeatures()`, registers commands, connects to the gateway, and disconnects cleanly on SIGINT or SIGTERM. If Discord rejects a well-formed setting, `explainRejectedSetting` turns the error into a message naming it.
- `packages/core` holds the feature registry (`createRegistry`), the Discord adapter (`registerGuildCommands`, `routeInteractions`) and `serializeError`. The registry refuses duplicate command names and dispatches each command to its handler. Every dispatch result carries the reply to send: an unknown command or a handler that throws gets a private error reply and a log entry, never a crash. The adapter sends that reply through Discord's interaction callback. Keep the core thin.
- `packages/ping` is the `/ping` feature.
- Each feature package exports a factory, such as `createPingFeature()`, that takes the feature's injected dependencies (Discord client, database, Claude client, clock) and returns a `Feature`. Command handlers take a parsed `CommandInvocation` and return a `Promise<CommandReply>`. That's the main testing seam.
- Internal packages are source-only: `exports` points at `src/*.ts`, and dependents use `workspace:*`. Shared dependency versions live in the `catalog` in `pnpm-workspace.yaml`.

Planned:

- `packages/db` holds the schema and migrations.
- The core gains the scheduler, and the bot starts it. Features also export autocomplete handlers, event handlers and scheduled jobs.

## Discord

- Two Discord applications. "Nozdormu Dev" runs locally, installed in a private test server. "Nozdormu" runs on Railway, installed in the guild server.
- Slash commands arrive over the gateway, so there's no public endpoint and no tunnel.
- On startup, bulk-overwrite the guild's commands (`PUT /applications/{id}/guilds/{guild}/commands`). For now this happens on every startup. Once there's a database, only do it when a stored hash of the command definitions has changed. Discord allows 200 command creates per day per guild.
- The bot's settings are listed in `.env.example`. Locally they live in a gitignored `.env` at the repo root, which the bot's scripts load with Node's `--env-file-if-exists`.
- Autocomplete returns at most 25 choices within 3 seconds.
- Anything slower than 3 seconds defers its reply, then edits it within the 15-minute interaction window.
- Request only the gateway intents that a feature needs.

## Scheduling and time

- The scheduler runs in-process. Each job's last run time is stored in Postgres, so a job missed during a restart or deploy runs when the bot starts.
- The guild plays on EU realms. Server time is one config setting, defaulting to `Europe/Paris`.
- Handlers get the time from the injected clock, never from the system clock directly.

## Database

- Generate SQL migrations with drizzle-kit and commit them. Railway's pre-deploy command applies them after the build and before the new version starts. If a migration fails, the deploy stops.
- Migrations only go forward. Each must work with the code that's already running: add things first, and drop columns in a later PR.
- The free plan has no backups. Decide on a backup job before storing anything members type in.
- Free projects pause after a week without database activity.

## Commands

- `pnpm check` runs everything CI runs: format check, lint, typecheck and tests.
- `pnpm dev` runs the bot against the Dev app and restarts it on changes. `pnpm start` runs it once.
- `pnpm smoke` starts the bot, waits for its ready log line, checks through Discord's API that its commands are registered, then stops it.
- `pnpm fmt` formats every file. `pnpm lint`, `pnpm typecheck` and `pnpm test` run one step each.
- `pnpm test <path>` runs a single test file.
- lefthook formats and lints staged files on each commit.

## Verifying work

Tests are the minimum. Before calling a change done, run `pnpm check` and `pnpm smoke`, and check the change against the real thing.

- Logs are pino JSON lines with a named `event`, plus durations and counts, and never message content or secrets. After a deploy, read them with `railway logs`.
- Log errors under the `err` key, and never log a raw error object any other way. The bot's logger passes `err` through `serializeError`, which keeps only the error's name, message, stack, HTTP status and code. Discord's request errors also carry the request URL, which can hold an interaction token, and the request body, which can hold message content.
- Only a real user can run a slash command. Never drive Andy's Discord account in the Discord app or web client; that's a self-bot, which Discord's terms forbid. At milestones, ask Andy to run the command in the test server. You can read back what the bot posted through the bot's own API access. The Developer Portal is fine to drive when Andy asks, but never reveal or copy a token or secret there; Andy handles those.

Planned, as the bot is built:

- Run migrations against local Postgres the way Railway's pre-deploy command will.
- Scheduled jobs have a dry-run mode that uses the real external source and prints what it would post instead of posting it.

## CI and deploy

- GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm check` on every PR and every push to `main`, in one job with the pnpm store cached. Actions are pinned to commit SHAs, and Renovate keeps them current.
- A ruleset on `main` requires the `check` job to pass, and blocks force-pushes and deleting the branch. Every change reaches `main` through a PR.

Planned:

- On push to `main`, after CI passes, a deploy job runs `railway up` with a Railway project token, in a `production` environment with a concurrency group. Don't rely on Railway's "Wait for CI" setting instead.
- Railway service settings live in `railway.toml`, which overrides the dashboard.
- Railway stops the old deployment with SIGTERM, then SIGKILL. Start the bot with `node` directly, not through `pnpm`, so the signal reaches it. Set `drainingSeconds` so `client.destroy()` has time to finish; Railway's docs don't state the default, and one report says it's 0.
