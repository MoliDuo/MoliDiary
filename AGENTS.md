# AGENTS.md

<!-- prettier-ignore-start -->
<!-- moli-rules:start -->
## Moli rules (copied verbatim from MoliSpec; do not edit)

These rules apply to every Moli repository. The full standards live in the private repo `MoliDuo/MoliSpec` (`standards/`).

**Naming**
- Product name `MoliFoo` (repo, package, file and identifier names, no spaces). User-facing name is `Moli Foo` (one space): window titles, app name, UI text, README title, Release titles.

**Deploy and CI**
- Deploy only after CI passes. Merging to `main` deploys to production (server apps), so run the check entry (`npm run check` or the stack's equivalent) locally before opening the PR, and watch CI and the deploy after it merges.
- Keep the CI names fixed: workflows `ci` / `deploy` / `release` / `codeql`; jobs `check`, `gitleaks`, `build`, `integration`, `ci-gate`.
- Never delete or skip tests, or loosen lint rules, to make a check pass.

**Git**
- Conventional Commits (`feat(scope): subject`).
- Never push to `main` directly. Every change, however small, goes on a new branch and is merged through a PR with auto-merge on. Before starting, update local `main` (`git switch main && git pull`) and branch from it; if a push is rejected or the branch is behind, pull the latest `main` and merge or rebase it in.
- Never force-push `main`. Roll back with `git revert`.

**Secrets and private information**
- Never commit secrets, `.env` files, keys, or internal information (server addresses, hostnames, Tailscale addresses, personal emails). Use obviously fake values in tests and examples (`test-token`, `example.com`, `192.0.2.1`).
- Never print secret values in logs, chat, or commits. Never store secrets in the OS keychain. Runtime secrets live in the server `.env` (mode 600); build and release secrets live in GitHub organization secrets.
- Do not copy a shared (organization-level) secret into repository-level secrets unless the administrator has said so.

**Login, data, config**
- Sign-in is Authelia only. Do not build your own accounts, passwords or registration pages.
- Database and settings schemas only add; never delete or rename an existing field in one step. Migrations must keep the previous app version working.
- Clients are offline-first and the server is authoritative. Settings are read in the order defined in the config standard; do not invent a second source.
- Server apps expose `GET /healthz` returning `{"ok": true, "version": "<commit sha>"}`, run as non-root, take config from environment variables, and publish no host ports.

**Working with the user**
- Do only what was asked. Do not publish, delete, or change shared settings (GitHub org, server, DNS) without being asked.
- Reply to the user in Chinese, briefly.
<!-- moli-rules:end -->
<!-- prettier-ignore-end -->

## About this project

Moli Diary (repo `MoliDiary`, app id `diary`, <https://diary.xiangyu.pro>) is a single-user personal diary. Entries are
encrypted at rest with a key derived from the master password; an AI (OpenAI-compatible API) adds a title, summary and
tags in an in-process queue. Next.js 16 App Router, React 19, Postgres through Drizzle and node-postgres, Tailwind 4.
It ships as one Docker image and runs behind Traefik on the Moli server. See `docs/architecture.md`.

## Run and test

- Install: `npm ci`
- Local database: `docker compose -f docker-compose.local.yml up -d`, then `cp .env.example .env.local` and `npm run db:migrate`
- Run locally: `npm run dev`
- Check (same as CI): `npm run check` (format, lint, types, migration consistency, dead code, tests with a coverage floor)
- Schema change: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the generated files in `drizzle/`.
  Migrations only add; to remove or rename something, stop using it in one release and drop it in the next.

## Do not touch

- Sign-in is Authelia through OIDC (standard 008, P1): `src/lib/auth/oidc.ts`, `login-flow.ts` and `src/app/auth/`. The
  app has no login page and only administrators get a session. The PIN only unlocks the data key (`src/app/unlock/`);
  never turn it back into a sign-in. The client secret lives only in the server `.env`, never in the repository.
- The persisted identifiers that still say `limen`: the key-derivation labels and AAD strings in `src/lib/crypto/`, the
  login-attempt hash label, the API token prefix and the session cookie names. They are part of the stored data and of
  issued credentials; changing one makes existing entries undecryptable or signs everyone out. Listed in `moli.yaml`.
- `drizzle/`: generated migrations. Never edit one that has been merged.
- The master password is not stored anywhere; never add code that logs, stores or sends it, or the data key.
