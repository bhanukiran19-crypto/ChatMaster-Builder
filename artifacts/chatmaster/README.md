# ChatMaster MVP

ChatMaster is an early chatbot-automation workspace. This MVP implements:

- Replit-managed Clerk sign-up/sign-in, with role-aware workspace membership.
- A live dashboard whose flow, published-flow, and node counts come from PostgreSQL.
- A visual trigger/message/condition flow builder with saved drafts, editing, publish state, and delete.
- Tenant-scoped FastAPI endpoints, input validation, role checks, and audit events for flow changes.

The public landing page contains an illustrative flow preview. It is not an active messaging integration.

## Run and configure

1. Use the ChatMaster web and API Server workflows in Replit.
2. Replit PostgreSQL supplies `DATABASE_URL`; do not copy it into source files. Clerk keys are managed through Replit Auth setup and are not checked in.
3. Apply the development database migration from the workspace root:

   ```sh
   cd artifacts/api-server/fastapi
   ../../../.pythonlibs/bin/python -m alembic upgrade head
   ```

4. Open the app preview, create an account, and create your first flow. Development and published Clerk users are separate.

Python dependencies are listed in `artifacts/api-server/fastapi/requirements.txt`. The API Server workflow runs the FastAPI service on loopback and exposes it only through the Clerk-verifying gateway. FastAPI is not directly reachable from the browser.

## Checks

From the workspace root:

```sh
pnpm run typecheck
```

From `artifacts/api-server/fastapi`:

```sh
../../../.pythonlibs/bin/python -m pytest
```

The automated API tests use an isolated in-memory SQLite database. The app itself uses PostgreSQL.

## Not connected yet

Contacts and segmentation, inbox and agent replies, knowledge-base AI, embedded website widget, conversation simulator, external webhooks, and messaging channels are not implemented in this MVP. No messaging provider is claimed as connected or tested. The API-based AI provider adapter is also deferred; there is no simulated AI response presented as real.
