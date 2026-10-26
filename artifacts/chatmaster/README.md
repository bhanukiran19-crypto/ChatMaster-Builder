# ChatMaster MVP

ChatMaster is an early chatbot-automation workspace. This MVP implements:

- Replit-managed Clerk sign-up/sign-in, with role-aware workspace membership.
- A live dashboard whose flow, published-flow, and node counts come from PostgreSQL.
- A React Flow-based visual editor with selectable and draggable steps, branch-aware connections, node configuration, save, and server-validated publication.
- A persisted draft simulator that executes messages, buttons, conditions, contact actions, delays, handoffs, and end steps without sending external messages.
- Tenant-scoped FastAPI endpoints, input validation, role checks, and audit events for flow changes.

The public landing page contains an illustrative flow preview. It is not an active messaging integration.

## Run and configure

1. Use the ChatMaster web and API Server workflows in Replit.
2. Replit PostgreSQL supplies `DATABASE_URL`; do not copy it into source files. Clerk keys are managed through Replit Auth setup and are not checked in.
3. If Python dependencies need to be restored, run this from the workspace root:

   ```sh
   uv pip install --python .pythonlibs/bin/python --requirements artifacts/api-server/fastapi/requirements.txt
   ```

4. Apply the development database migration from the workspace root:

   ```sh
   cd artifacts/api-server/fastapi
   ../../../.pythonlibs/bin/python -m alembic upgrade head
   ```

5. Open the app preview, create an account, and create your first flow. Development and published Clerk users are separate.

Python dependencies are listed in `artifacts/api-server/fastapi/requirements.txt`. The API Server workflow runs the FastAPI service on loopback and exposes it only through the Clerk-verifying gateway. FastAPI is not directly reachable from the browser.

## Current implementation status

- Flow graph edits are stored as drafts in PostgreSQL. Publishing validates the graph and stores a separate immutable snapshot.
- The simulator runs the saved draft through the backend interpreter and persists its trace and test context. Each simulation is limited to 100 total node executions, including across visitor replies.
- Delay steps are recorded but do not wait in real time. Human handoff pauses the simulation. AI-response steps fail explicitly until an AI provider is configured.
- This is not yet a live messaging runtime: published flows are not started by incoming customer events, and simulations do not create customer-visible messages.

## Remaining product roadmap

- [ ] Contacts, tags, custom fields, consent, and segmentation
- [ ] Unified inbox, assignments, internal notes, and agent replies
- [ ] Website chat widget and visitor sessions
- [ ] AI provider abstraction and knowledge-base ingestion
- [ ] Webhook management and verified channel adapters
- [ ] Analytics, workspace settings, and expanded security coverage

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

Contacts and segmentation, inbox and agent replies, knowledge-base AI, embedded website widget, external webhooks, and messaging channels are not implemented. No messaging provider is claimed as connected or tested. The simulator is isolated from real channels, and it does not return fabricated AI responses.
