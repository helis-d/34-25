# 3425

3425 is a fast, quiet discussion platform for sharing ideas, asking questions, and showing things you've built.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/3425/src/App.tsx` — responsive product shell, routes, auth, feeds, post detail, comments, search, and theme controls.
- `artifacts/3425/src/index.css` — the 3425 light/dark visual system.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts and generated client hooks.
- `artifacts/api-server/src/routes/community.ts` — auth, feeds, posts, comments, voting, profiles, search, reports, and upload URL behavior.
- `lib/db/src/schema/index.ts` — PostgreSQL tables, indexes, relations, and vote uniqueness constraints.
- `artifacts/api-server/src/lib/objectStorage.ts` and `src/routes/storage.ts` — App Storage upload and serving support.

## Architecture decisions

- The browser is a Vite-rendered React client using generated OpenAPI hooks; the API is kept in the shared Express service so path-based preview routing stays simple.
- Sessions are opaque, HttpOnly cookies backed by PostgreSQL; passwords use Node's built-in scrypt and are never stored in plaintext.
- Posts and comments use soft deletion so discussion trees remain structurally intact.
- Votes are upvotes only, with separate unique indexes enforcing one active post vote and one active comment vote per user.
- Media bytes use App Storage through presigned uploads; PostgreSQL stores only media metadata and object paths.

## Product

The MVP includes TOP/NEW/ASK/SHOW feeds, persistent accounts, post creation/editing/deletion, Markdown with fenced code blocks and copy feedback, nested comments, upvotes, profiles, PostgreSQL full-text search, reports, light/dark mode, and responsive mobile navigation.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The API and web services are separate managed workflows; the web calls the API through `/api`.
- Uploads are two-step: request a signed URL from the API, then PUT the file directly to App Storage.
- `pnpm --filter @workspace/api-spec run codegen` must be run after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
