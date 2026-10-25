# ChatMaster

ChatMaster helps teams create and manage chatbot conversation flows. The current MVP includes secure sign-in, a workspace dashboard, and a PostgreSQL-backed visual flow builder.

## Run & Operate

- The `artifacts/chatmaster: web` workflow runs the ChatMaster frontend.
- The `artifacts/api-server: API Server` workflow runs the Clerk gateway and its private FastAPI service.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `cd artifacts/api-server/fastapi && ../../../.pythonlibs/bin/python -m alembic upgrade head` — apply development migrations
- `cd artifacts/api-server/fastapi && ../../../.pythonlibs/bin/python -m pytest` — run FastAPI tests
- Required runtime env: Replit PostgreSQL `DATABASE_URL`; Clerk keys are provisioned through Replit Auth.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, TypeScript, Vite, Wouter, TanStack Query
- Auth: Replit-managed Clerk
- API gateway: Express 5 (Clerk session verification and forwarding)
- Product API: Python FastAPI, SQLAlchemy, Alembic
- DB: PostgreSQL (JSONB flow graphs)
- Validation: Pydantic on the FastAPI API; OpenAPI-generated TypeScript client
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/chatmaster/` — app pages, visual flow builder, theme, and MVP setup notes
- `artifacts/api-server/fastapi/` — FastAPI routes, SQLAlchemy models, Alembic migrations, and API tests
- `artifacts/api-server/src/` — Clerk-aware gateway and health route
- `lib/api-spec/openapi.yaml` — frontend API contract source of truth
- `artifacts/chatmaster/README.md` — setup notes and explicit feature-scope limitations

## Architecture decisions

- The Express service is a thin public gateway for Clerk; FastAPI owns the workspace and flow API.
- FastAPI binds to loopback only; the gateway validates the Clerk session and replaces identity headers before forwarding.
- Tenant scope is derived from the signed-in Clerk user’s workspace membership, never from a client-supplied workspace ID.
- Flow node graphs are stored as JSONB and checked for valid node/edge references before saving.

## Product

The MVP supports Clerk sign-up/sign-in, one automatically provisioned workspace per account, role-aware flow editing, flow persistence and publication state, live dashboard counts, and audit events for flow changes. Contacts, inbox, AI knowledge answers, website widget, simulator, webhooks, and messaging channels are not connected yet.

## User preferences

- Keep future messaging integrations explicitly marked as unconnected until they use an official API and have been tested.

## Gotchas

- Apply the FastAPI Alembic migration before the first API workflow start against a fresh development database.
- The API gateway starts FastAPI as a private loopback sidecar; do not expose its internal port as a public service.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
