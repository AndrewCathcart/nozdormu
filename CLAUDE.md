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
- pino for structured logging, created with `createLogger()` from core. Code takes a `Pick<Logger, ...>` of the methods it uses (`Logger` is re-exported from core), so tests can pass a typed fake.
- Vitest 5, finding `*.test.ts` files anywhere. Database tests run against real Postgres, not mocks.
- `minimumReleaseAge` in `pnpm-workspace.yaml` refuses packages published less than a day ago. Pin the previous release rather than adding an exclusion. Renovate waits 3 days before proposing an update.
- Postgres on Supabase's free plan, reached through Supabase's session pooler, which supports the prepared statements postgres.js uses. (The transaction pooler would need `prepare: false`.) Drizzle ORM 0.45 with postgres.js, and drizzle-kit 0.31.
- Locally, Postgres 18.4 runs in DBngin, not Docker: the server called "nozdormu" on port 5433, which accepts the `postgres` user without a password. Never touch the server on port 5432; it holds Andy's other projects. Only create, use and drop databases whose names start with `nozdormu_`. The bot's local database is `nozdormu_dev`. CI runs a `postgres:18.4` service container on port 5433. Match Supabase's major version once the project exists.
- zod 4 for env validation. lefthook for git hooks. Renovate for dependency updates.
- Hosted on Railway Hobby. The Claude API writes the newspaper.

## Architecture

Built so far:

- `apps/bot` is the process. `src/main.ts` loads config (`loadConfig` validates the environment and names bad settings without echoing values), connects to Postgres, builds the features with `createFeatures(createFeatureDeps(...))` (`src/features.ts` lists every feature and builds the real outside-world dependencies they get; `pnpm job --dry-run` swaps some for printing versions), builds the registry, registers commands if they changed since the last start, connects to the gateway, and disconnects cleanly on SIGINT or SIGTERM. `src/migrate.ts` applies pending migrations; Railway will run it before each deploy. Both use `src/startup.ts`, which exits with a message naming the setting when config is invalid, Postgres refuses the connection, or Discord rejects a setting during registration or login. `src/startup-failures.ts` turns Discord's and Postgres's rejections into those messages.
- `packages/core` holds the feature registry (`createRegistry`), the Discord adapters (`registerGuildCommands`, `routeInteractions`, `createChannelPublisher`, `createRecentPostReader`), `registerCommandsIfChanged`, `createLogger` and `serializeError`. The registry refuses duplicate command names, dispatches each command (with its options) to its handler, and routes autocomplete requests to the command's `autocomplete`, keeping Discord's limit of 25 suggestions and returning none if suggesting fails. Every dispatch result carries the reply to send: an unknown command or a handler that throws gets a private error reply and a log entry, never a crash. The adapter sends that reply through Discord's interaction callback. Keep the core thin.
- `packages/db` holds the Drizzle schema (`src/schema.ts`), the committed migrations (`migrations/`), `connectDatabase` (which runs `select 1`, so a bad URL fails straight away), `runMigrations` (which returns how many it applied), and the Postgres stores the core needs (`createCommandRegistrationStore`, `createJobRunStore`). A feature's own store lives in the feature package. `@nozdormu/db/testing` gives each test file its own database.
- `packages/core` also holds the scheduler (`startScheduler`). A `Feature` declares its `commands` and scheduled `jobs`, leaving out what it doesn't use. The bot starts the scheduler before it registers commands or logs in (jobs use Discord's REST API, not the gateway), and on shutdown stops it first, then Discord, then the database.
- `packages/ping` is the `/ping` feature.
- `packages/youtube` is the YouTube alert: `parseFeed`, a feed reader that retries YouTube's frequent short outages (bad status, timeout, network error or unreadable feed, 3 attempts 3 s apart), the `youtube.poll` job (every 10 minutes), and the Postgres `SeenVideoStore`. Its first check records the channel's existing videos (and that the check happened, even with an empty feed) without posting. After that, each unseen video newer than the newest one recorded is posted oldest first, and recorded only once its post succeeds, so a failed post is retried at the next check without holding up the others. The first check also stores a baseline, the newest publish time in its feed; an unseen video no newer than that is an old one resurfacing after a deletion, so it's recorded without posting. (Every later upload gets posted and recorded, so a resurfacing video is never newer.) Before posting, the bot reads the channel's last 50 messages and skips any video linked in one of its own, which covers a crash between posting and recording. A failure to post or record one video doesn't stop the others; the check then fails and is logged. Each post carries the nonce `yt-<video id>` with `enforce_nonce`, so Discord drops a repeat sent within a few minutes. Posts never ping anyone (`allowed_mentions: { parse: [] }`).
- `packages/gamedata` is the game database. `/item` suggests items as you type (Postgres trigram search on names containing the text, names starting with it first; deprecated, test and placeholder items hidden), then replies publicly with the item's quality, slot, item level, required level and Wowhead link, crediting wago.tools. The hourly `gamedata.check_build` job imports each new Forever build's `ItemSparse` from wago.tools (product `foreverProduct`, currently `wow_classic_beta`; only 1.6x versions), replacing the stored items in one transaction. Item stats are stored as budget shares, so exact stat values aren't shown yet (see issue #2).
- All tables live in `packages/db/src/schema.ts`, so drizzle-kit sees one schema. A feature's store lives in the feature package and imports its table from `@nozdormu/db`.
- Each feature package exports a factory, such as `createPingFeature()`, that takes the feature's injected dependencies (for example the Discord REST client, the database, the Claude client, a clock) and returns a `Feature`. Command handlers take a parsed `CommandInvocation` and return a `Promise<CommandReply>`. That's the main testing seam.
- Internal packages are source-only: `exports` points at `src/*.ts`, and dependents use `workspace:*`. Shared dependency versions live in the `catalog` in `pnpm-workspace.yaml`.

Planned:

- Features also export event handlers.

## Discord

- Two Discord applications. "Nozdormu Dev" runs locally, installed in a private test server. "Nozdormu" runs on Railway, installed in the guild server.
- Slash commands arrive over the gateway, so there's no public endpoint and no tunnel.
- On startup, bulk-overwrite the guild's commands (`PUT /applications/{id}/guilds/{guild}/commands`). `registerCommandsIfChanged` only does this when the command definitions' hash differs from the one stored for that application in that server. Discord allows 200 command creates per day per guild.
- The bot's settings are listed in `.env.example`. Locally they live in a gitignored `.env` at the repo root, which the bot's scripts load with Node's `--env-file-if-exists`.
- Autocomplete returns at most 25 choices within 3 seconds.
- Anything slower than 3 seconds defers its reply, then edits it within the 15-minute interaction window.
- Request only the gateway intents that a feature needs.

## Scheduling and time

- The scheduler runs in-process, on intervals of 1 ms to about 24.8 days (setTimeout's limit). Each job's name is unique (e.g. `youtube.poll`).
- Before each run, the scheduler claims it in the `job_runs` table: one atomic statement records the start time, but only if the job is due (never ran, or its last run started at least one interval earlier). So two processes (say, old and new during a deploy) never both start the same interval's run, and a run that dies halfway isn't repeated until its next interval. Jobs run at most once per interval. The claim isn't a lock: a run that outlasts its interval could overlap the next one in another process, so keep runs well within their interval. The scheduler logs `job.overrunning` when a run is still going one interval after it started.
- At startup, a job that never ran or fell due while the bot was down is tried straight away; otherwise it waits until one interval after its last start, and never longer than one interval. If the last run can't be looked up, it's tried straight away and the claim decides. If the claim itself fails (`job.claim_failed`), the job doesn't run and is tried again an interval later.
- A job that throws is logged as `job.failed` and runs again at its next interval. Each finished run is logged as `job.finished` with its duration.
- Stopping the scheduler starts no new runs (a claim that comes back after stopping is skipped, so that interval's run is lost), waits up to 10 seconds for runs in progress, then logs `scheduler.stop_timed_out` naming any it gave up on. The bot installs its SIGINT/SIGTERM handlers straight after starting the scheduler.
- The guild plays on EU realms. Server time is one config setting, defaulting to `Europe/Paris`.
- Handlers get the time from the injected clock, never from the system clock directly.

## Database

- Change `packages/db/src/schema.ts`, run `pnpm db:generate --name <what_changed>` (or `--custom` for SQL drizzle-kit can't generate, such as `CREATE EXTENSION`), and commit the generated SQL and its `meta/` files. Never edit a migration that has been merged. Railway's pre-deploy command will apply them after the build and before the new version starts. If a migration fails, the deploy stops.
- Migrations only go forward. Each must work with the code that's already running: add things first, and drop columns in a later PR.
- Database tests use real Postgres, never mocks. At the top of a test file, `const database = useTestDatabase()` (from `./testing.ts` inside `packages/db`, or `@nozdormu/db/testing` elsewhere) gives that file its own database, copied from a template that Vitest's global setup migrates once per run. Use `database.db` inside tests. `useTestDatabase({ migrated: false })` gives an empty one. Global setup also drops test databases more than an hour old, left by killed runs. Tests connect to the server's `postgres` database only to create and drop their own. Unit tests of logic that uses a store may pass an in-memory fake of the store's interface.
- The free plan has no backups. Decide on a backup job before storing anything members type in.
- Free projects pause after a week without database activity.

## Commands

- `pnpm check` runs everything CI runs: format check, lint, typecheck and tests.
- `pnpm dev` runs the bot against the Dev app and restarts it on changes. `pnpm start` runs it once.
- `pnpm job <job-name>` runs one scheduled job once, outside the scheduler (it doesn't claim the run in `job_runs`), for real, including posting to Discord. `pnpm job <job-name> --dry-run` uses the real feed and database but prints what it would post or record, and changes nothing.
- `pnpm smoke` starts the bot, waits for its ready log line, checks through Discord's API that Discord has exactly the commands the bot logged as its own, then stops it.
- `pnpm fmt` formats every file. `pnpm lint`, `pnpm typecheck` and `pnpm test` run one step each.
- `pnpm test <path>` runs a single test file. Tests need the DBngin "nozdormu" server running.
- `pnpm db:migrate` applies pending migrations to `DATABASE_URL` and logs how many it applied. `pnpm db:generate` writes a migration from schema changes.
- lefthook formats and lints staged files on each commit.

## Verifying work

Tests are the minimum. Before calling a change done, run `pnpm check` and `pnpm smoke`, and check the change against the real thing.

- Logs are pino JSON lines with a named `event`, plus durations and counts, and never message content or secrets. After a deploy, read them with `railway logs`.
- Log errors under the `err` key, and never log a raw error object any other way. The logger from `createLogger()` passes `err` through `serializeError`, which keeps only the error's name, message, stack, HTTP status, code and (recursively) cause. That's because Discord's request errors carry the request URL, which can hold an interaction token, and the request body, which can hold message content. It also replaces the message of Drizzle's failed-query errors, which list the query's parameter values, and of Postgres's data errors (SQLSTATE class 22), which repeat the rejected value.
- Only a real user can run a slash command. Never drive Andy's Discord account in the Discord app or web client; that's a self-bot, which Discord's terms forbid. At milestones, ask Andy to run the command in the test server. You can read back what the bot posted through the bot's own API access. The Developer Portal is fine to drive when Andy asks, but never reveal or copy a token or secret there; Andy handles those.

- After adding a migration, run `pnpm db:migrate` twice against `nozdormu_dev`: the second run must do nothing.

- Check a scheduled job with `pnpm job <job-name> --dry-run` against the real source before running it for real. A dry run prints the posts it would make to the terminal, never into the logs. Its posts go to the channels in `.env`, which point at Nozdormu Test.

## CI and deploy

- GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm check` on every PR and every push to `main`, in one job with the pnpm store cached. Actions are pinned to commit SHAs, and Renovate keeps them current.
- A ruleset on `main` requires the `check` job to pass, and blocks force-pushes and deleting the branch. Every change reaches `main` through a PR.

Planned:

- On push to `main`, after CI passes, a deploy job runs `railway up` with a Railway project token, in a `production` environment with a concurrency group. Don't rely on Railway's "Wait for CI" setting instead.
- Railway service settings live in `railway.toml`, which overrides the dashboard.
- Railway stops the old deployment with SIGTERM, then SIGKILL. Start the bot with `node` directly, not through `pnpm`, so the signal reaches it. Set `drainingSeconds` to about 20, so shutdown can finish: the scheduler waits up to 10 seconds for running jobs, then Discord and the database close. Railway's docs don't state the default, and one report says it's 0.
