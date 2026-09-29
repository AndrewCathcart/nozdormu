# Nozdormu

A Discord bot for an EU guild in World of Warcraft: Forever, Blizzard's "Classic+" (launches 2026-11-04). One always-on Node process holds a gateway connection through discord.js. Andy builds it alone. Work is tracked in GitHub Issues.

## Process

This section overrides Andy's global `~/.claude/CLAUDE.md` where they differ.

- Use only two Matt Pocock skills: `mattpocock-skills:tdd` and `mattpocock-skills:code-review`.
- Don't use the planning chain (`/setup-matt-pocock-skills`, `/grill-me`, `/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement`, `/triage`, `/wayfinder`) or any other Matt Pocock skill, such as `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `research` or `prototype`, unless Andy asks for it.
- Every PR description starts with its spec: 3–6 plain bullets saying what the change should do, not how, written before any code. TDD writes tests from that list, and code review checks the code against it. Link the issue with `Closes #n`.
- Agree the test boundaries with Andy before writing tests.
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

- `packages/core` holds the feature registry (`createRegistry`). It collects every feature's command definitions for Discord, and dispatches each command to its handler. An unknown command is logged and returns a result instead of throwing. Keep the core thin.
- `packages/ping` is the `/ping` feature.
- Each feature package exports a factory, such as `createPingFeature()`, that takes the feature's injected dependencies (Discord client, database, Claude client, clock) and returns a `Feature`. Command handlers take a parsed `CommandInvocation` and return a `Promise<CommandReply>`. That's the main testing seam.
- Internal packages are source-only: `exports` points at `src/*.ts`, and dependents use `workspace:*`. Shared dependency versions live in the `catalog` in `pnpm-workspace.yaml`.

Planned:

- `apps/bot` is the process. It connects to the gateway, loads the feature packages and starts the scheduler.
- `packages/db` holds the schema and migrations.
- The core gains the Discord adapters and the scheduler. Features also export autocomplete handlers, event handlers and scheduled jobs.

## Discord

- Two Discord applications. "Nozdormu Dev" runs locally, installed in a private test server. "Nozdormu" runs on Railway, installed in the guild server.
- Slash commands arrive over the gateway, so there's no public endpoint and no tunnel.
- On startup, bulk-overwrite the guild's commands (`PUT /applications/{id}/guilds/{guild}/commands`), but only when a stored hash of the command definitions has changed. Discord allows 200 command creates per day per guild.
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
- `pnpm fmt` formats every file. `pnpm lint`, `pnpm typecheck` and `pnpm test` run one step each.
- `pnpm test <path>` runs a single test file.
- lefthook formats and lints staged files on each commit.

## Verifying work

Tests are the minimum. Before calling a change done, run `pnpm check`, and check the change against the real thing. Planned, as the bot is built:

- Run migrations against local Postgres the way Railway's pre-deploy command will.
- Smoke-run the dev bot: start it, wait for its ready log line, confirm through Discord's API that its commands are registered, then stop it.
- Scheduled jobs have a dry-run mode that uses the real external source and prints what it would post instead of posting it.
- Logs are structured, with named events, durations and counts, and never message content. After a deploy, read them with `railway logs`.
- Only a real user can run a slash command. Never drive Andy's Discord account through the browser; that's a self-bot, which Discord's terms forbid. At milestones, ask Andy to run the command in the test server. You can read back what the bot posted through the bot's own API access.

## CI and deploy

- GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm check` on every PR and every push to `main`, in one job with the pnpm store cached. Actions are pinned to commit SHAs, and Renovate keeps them current.

Planned:

- A ruleset on `main` requires CI to pass.
- On push to `main`, after CI passes, a deploy job runs `railway up` with a Railway project token, in a `production` environment with a concurrency group. Don't rely on Railway's "Wait for CI" setting instead.
- Railway service settings live in `railway.toml`, which overrides the dashboard.
