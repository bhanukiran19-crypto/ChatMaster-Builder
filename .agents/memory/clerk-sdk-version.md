---
name: Clerk SDK version alignment
description: Lessons from aligning the ChatMaster Clerk React package with its actual exports and dependencies.
---

Use the exports and dependency versions present in the installed Clerk SDK, rather than assuming examples from another SDK generation apply unchanged. In this project, `@clerk/react` 6 uses `Show` for signed-in/out rendering; an earlier package resolution had incompatible shared exports, so keep the Clerk React packages aligned.

**Why:** The initial package version passed type checking but failed Vite's runtime dependency scan because it imported an export missing from its resolved `@clerk/shared` package.

**How to apply:** Check installed declarations and run the Vite app after Clerk package changes. Keep the browser publishable key sourced from Replit's injected environment and preserve server-side session verification in the Express gateway.
