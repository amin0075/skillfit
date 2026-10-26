---
name: next-server-security
description: Next.js App Router server-side security - Server Actions as public endpoints, data access layer and DTOs, authz in proxy.ts vs at the data, Cache Components with user data, route handler CSRF, secrets and client-boundary leaks. Use when writing or reviewing Server Actions, route.ts, proxy/middleware, auth, data fetching, or caching of user-specific data.
---

# Next.js server security

Next.js-specific failure modes that generic OWASP checklists miss. For the general OWASP pass, also use `owasp-security-check`. Canonical reference: https://nextjs.org/docs/app/guides/data-security.

## Entry points (audit every one)

| Entry point | Why it is public |
| --- | --- |
| Every exported function in a `"use server"` file that the app uses | Reachable by direct `POST`, not only through your UI. Encrypted action IDs and dead-code elimination reduce exposure; they are not access control. |
| Inline `"use server"` functions in components | Same. A page-level auth check or `redirect()` does **not** protect the actions defined on that page. |
| `route.ts` handlers | Plain HTTP. No built-in Origin check (unlike Server Actions). |
| `proxy.ts` (Next 16; `middleware.ts` before) | Runs on matched requests only and is easy to bypass or mis-match. |
| `[param]` segments, `searchParams`, headers, cookies | User input. |

## Rules

1. **Authorize at the data, not the route.** Put auth + authorization in a server-only data access layer (DAL): `import "server-only"`, a `cache()`d `getCurrentUser()`, then ownership checks before every read or write. `proxy.ts` is for optimistic redirects only. (CVE-2025-29927 let attackers skip middleware entirely with one header; apps that also checked in the DAL were safe.)
2. **Every Server Action re-verifies.** Inside the action (or the DAL function it calls): authenticate, authorize the specific resource (IDOR), then mutate. Identity comes from the session, never from an argument, a hidden input, or a `.bind()` value.
3. **Validate every action argument at runtime.** TypeScript types are erased; parse `FormData` and arguments with a schema (`z.safeParse` or the repo's validator) and return a typed error state instead of throwing raw errors.
4. **Return DTOs, not records.** Action return values and props passed to Client Components are serialized to the browser (RSC payload / HTML). Select only the fields the UI needs. Never pass a full ORM row, user object, or session to a `"use client"` component. For defense in depth enable `experimental.taint` and use `experimental_taintObjectReference` / `experimental_taintUniqueValue` on secrets and raw records.
5. **Secrets stay in the DAL.** Only server-only modules read `process.env` secrets and DB clients. Anything prefixed `NEXT_PUBLIC_` ships in the client bundle; never put keys there. Validate env at startup with a schema.
6. **Cache Components and user data.**
   - `"use cache"` output is shared across users and requests. `cookies()`, `headers()`, and `searchParams` are not allowed inside it; pass values in as arguments, and they become part of the cache key.
   - A cached function that takes `userId` returns that user's data to *any* caller who passes the id: authorize **before** calling it, outside the cache boundary.
   - Per-user personalized results: `"use cache: private"` (never stored in a server cache across requests) or no cache.
   - After a mutation, invalidate what you changed: `updateTag(tag)` inside the action for read-your-own-writes, `revalidateTag(tag, "max")` for stale-while-revalidate, or `revalidatePath`.
7. **Route handlers that mutate with cookie auth need CSRF protection.** Prefer Server Actions (Next checks `Origin` against `Host`). Otherwise verify the `Origin` header, require a non-simple content type or a CSRF token, and keep session cookies `SameSite=Lax` or stricter, `HttpOnly`, `Secure`. Behind a reverse proxy or alternate domain, set `serverActions.allowedOrigins` instead of disabling checks.
8. **No mutations during render.** Logging out, writing, or revalidating from a page because of a `searchParams` value is a GET side effect. Use an action.
9. **Redirects.** `redirect(searchParams.callbackUrl)` is an open redirect. Allow only same-origin relative paths (starts with `/`, not `//`).
10. **Headers.** Static security headers go in `next.config` `headers()`. A nonce-based CSP is generated in `proxy.ts` and forces dynamic rendering for those routes; choose that trade-off deliberately.
11. **Self-hosting multiple instances:** set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` so closure encryption works across instances. Encryption of closed-over values is not a reason to close over secrets.
12. **Rate-limit expensive actions** (email, signup, AI calls, uploads) by user and IP.
13. **Stay on the latest patch of your Next.js and React line.** RSC protocol bugs are critical (React2Shell, CVE-2025-55182, was unauthenticated RCE in Next 15.x/16.0 App Router apps). Check the repo's audit command and https://github.com/vercel/next.js/security/advisories when touching dependencies.

## Server Action shape

```ts
// app/posts/actions.ts
"use server";

import { z } from "zod";
import { updateTag } from "next/cache";
import { deletePost } from "@/data/posts"; // server-only DAL: auth + ownership inside

const Input = z.object({ postId: z.string().uuid() });

export async function deletePostAction(_prev: unknown, formData: FormData) {
  const parsed = Input.safeParse({ postId: formData.get("postId") });
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  await deletePost(parsed.data.postId); // throws/returns forbidden if not the owner
  updateTag(`posts`);
  return { ok: true as const }; // minimal result, no DB row
}
```

## Review output

For each finding: entry point, file:line, what an attacker sends, impact, fix. Check the repo's actual auth library and DAL location first; do not assume paths.
