# Admin-Dashboard Security Audit — JezSy

Date: 2026-07-23. Companion to `backend-security-audit-2026-07-23.md`. Audits the **separate** `admin-dashboard` repo (github.com/carvele/admin-dashboard, local `C:\Users\carlv\admin-dashboard`), pulled to commit `2b83f07`, which is a first-class consumer of the same Supabase database. Scope: client key handling, the staff-account edge functions, auth/role gating, secret hygiene, and RLS alignment. **No credential value and no customer row data was read or printed** (`serviceAccountKey.json` and `database_dump.json` were deliberately left unopened).

Stack: Vite + React 18 SPA (JS/JSX), `@supabase/supabase-js`, Cloudinary for image uploads, Sentry, two Supabase edge functions. Legacy Firebase tooling still present in the working tree (migration leftovers).

## What was and was not inspected

- **Inspected:** Supabase client init, both edge functions (`create-staff-account`, `activate-staff-account`), `permissions.js`, the Login/SetPassword staff-invite flow, storage/Cloudinary upload, `.gitignore` + git history for secrets, and a source-wide grep for service-role usage and XSS sinks.
- **Not inspected:** full page-by-page UI review; runtime behavior (app not launched); contents of `serviceAccountKey.json` / `database_dump.json` (credential + customer data — excluded by policy).

## Severity summary

| # | Severity | Finding |
|---|----------|---------|
| A-1 | **High** | `serviceAccountKey.json` (Firebase Admin credential) and `database_dump.json` (customer data) are in the working tree and **not gitignored** |
| A-2 | Medium | `.env.example` is stale: real legacy Firebase values committed; documents none of the Supabase/Cloudinary vars the app actually uses |
| A-3 | Medium | Cloudinary **unsigned upload preset** exposed client-side — arbitrary uploads to the account |
| A-4 | Low | Edge-function CORS is `Access-Control-Allow-Origin: *` |
| A-5 | Low | Legacy Firebase migration tooling left in the tree (dead attack surface) |
| A-6 | Info (good) | Staff-account edge functions are correctly designed — server-side role checks, tamper-proof role via `app_metadata` |
| A-7 | Info (good) | Client uses anon key only; RLS treated as the real boundary; no XSS sinks; no service-role in bundle |

**Bottom line:** the security-critical logic — how staff accounts are created and how roles are assigned — is done **right**, server-side, with an explicit and correct threat model. The real risk here is not the code; it is **secret hygiene in the working tree** (A-1) and **stale/ambiguous configuration** (A-2). Fix the `.gitignore` before the next `git add`.

---

## High

### A-1 — Unignored secrets in the working tree

- **What:** `git status` shows two untracked files that `git check-ignore` confirms are **NOT** covered by `.gitignore`:
  - `serviceAccountKey.json` — a Firebase Admin SDK service-account key (full administrative access to the `jeszybotiquear` Firebase project). Consumed by `scripts/export_db.cjs`.
  - `database_dump.json` — a full database export (customer PII).
- **Why it matters:** The repo is public on GitHub. A single `git add -A && git commit && git push` — routine when staging unrelated work — would publish a live admin credential and a customer-data dump irreversibly (git history + anyone who cloned in the interim). This is the highest-impact issue across both repos.
- **Mitigating fact:** `git log --all` confirms **neither file, nor `.env`, has ever been committed** — so nothing is leaked yet and no key rotation is required *today*. This is a prevention fix, not an incident.
- **Recommendation (do first):** Add to `.gitignore` now:
  ```
  serviceAccountKey.json
  database_dump.json
  *.key.json
  ```
  Also consider ignoring the other untracked scratch artifacts (`Chapter 2.pdf`, `*_extracted.txt`, `FINAL REQUIREMENTS/`, `Hardware_Requirements_*.txt`, `read_docx.py`) so they can't be swept into a commit. After ignoring, verify with `git check-ignore serviceAccountKey.json database_dump.json`.

---

## Medium

### A-2 — `.env.example` is stale and carries real legacy Firebase values

- **What:** The committed `.env.example` documents only **Firebase** variables and fills them with **real values** — e.g. `VITE_FIREBASE_API_KEY=AIzaSyBh…WC4U`, `VITE_FIREBASE_PROJECT_ID=jeszybotiquear`, sender ID, app ID (full key redacted here). It contains **no** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, or `VITE_CLOUDINARY_*` — the variables the app actually reads (`supabaseClient.js`, `storage.js`, `StaffManagement.jsx`).
- **Why it matters:**
  1. **Onboarding breakage:** copying this template to `.env` yields a non-functional app (missing every Supabase/Cloudinary var) while providing Firebase vars nothing in the current code uses.
  2. **Legacy exposure:** Firebase web API keys are public-by-design (identifiers, not secrets — real protection is Firebase Security Rules + authorized domains), so this is not a leaked secret per se. But the presence of the key **plus** the Firebase Admin `serviceAccountKey.json` in the tree means the old `jeszybotiquear` project should be confirmed **locked down or decommissioned**. An abandoned-but-live Firebase project with permissive rules is a data-exposure path independent of Supabase.
- **Recommendation:** Rewrite `.env.example` to reflect the current stack with empty placeholders (`VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`, `VITE_CLOUDINARY_CLOUD_NAME=`, `VITE_CLOUDINARY_UPLOAD_PRESET=`, `VITE_SENTRY_DSN=`). Remove the real Firebase values. Separately, verify the legacy Firebase project's status.

### A-3 — Cloudinary unsigned upload preset exposed to the client

- **What:** `src/lib/storage.js` uploads directly to Cloudinary using `VITE_CLOUDINARY_CLOUD_NAME` + `VITE_CLOUDINARY_UPLOAD_PRESET`; the error text confirms the preset must be **Unsigned**. Both values ship in the JS bundle.
- **Why it matters:** Anyone can read the cloud name and unsigned preset from the public bundle and `POST` to `api.cloudinary.com/.../upload` to store arbitrary images on the account — storage/bandwidth abuse and potential hosting of unwanted content under the brand's account.
- **Recommendation:** Constrain the unsigned preset in the Cloudinary console (allowed formats, max size, fixed folder, moderation, incoming transformations), or move uploads behind a signed flow (an edge function signs the request; the preset stays server-side). Constraining the preset is the low-effort mitigation.

---

## Low / Informational

- **A-4 — Edge-function CORS is `*`.** Both `create-staff-account` and `activate-staff-account` set `Access-Control-Allow-Origin: *`. Acceptable, because authorization rests on the verified JWT + role check, not the origin (a forged origin gains nothing). Tightening to the known admin dashboard origin is cheap defense-in-depth and reduces CSRF-style noise.
- **A-5 — Legacy Firebase tooling in the tree.** `functions/src/triggers/staffTriggers.ts` (firebase-admin Firestore triggers), `scripts/export_db.cjs`, and `serviceAccountKey.json` are Firebase→Supabase migration leftovers. Once the migration is confirmed complete, remove them — this shrinks the credential/attack surface and directly retires the A-1 risk. Until then, keep them ignored (A-1).
- **A-6 (Good) — Staff-account edge functions are correctly designed.** Worth recording as a strength:
  - `create-staff-account` verifies the caller against **their own `profiles` row** (`role in (admin, owner)`, not deleted, not blocked) using the service-role client *after* identifying the caller from their JWT — it never trusts a client-supplied role/identity.
  - Authoritative role is written to `app_metadata.staff_role` (service-role-only, **not** the user-writable `user_metadata`), and `activate-staff-account` reads it back from there — closing the classic self-promotion hole. Double-activation is guarded. The inline comments show the threat model is understood.
  - The `Login.jsx` "super admin creates staff" path re-authenticates the admin and checks role client-side *and* the edge function re-checks server-side — defense in depth; the server check is the real gate.
- **A-7 (Good) — Client key handling and injection surface are clean.** `supabaseClient.js` uses `VITE_SUPABASE_ANON_KEY` only; a source-wide grep found **no** service-role key anywhere in `src/` (only in `supabase/functions/*` server code and the local `scripts/export_db.cjs`). `permissions.js` explicitly documents that the UI permission matrix is UX and **RLS is the enforcement boundary**. No `dangerouslySetInnerHTML`, `innerHTML`, or `eval` sinks in `src/`; inputs pass through `sanitizeText` and DOMPurify is available.

## Cross-repo ties to the mobile-app audit

- **Mobile M-5 (`approve_device` auto-approves every device)** lives on the `devices` table this dashboard manages (`manage_devices` is owner-only per `permissions.js`). If device approval is meant to be a real trust gate, the DB trigger currently defeats it regardless of what this UI does — fix belongs at the DB/trigger level.
- **Mobile L-9 (shared trust boundary)** is now substantiated: this dashboard is where `admin`/`owner`/`staff` roles are minted, and it does so correctly (A-6). The strength of every `is_staff_or_admin()` / `is_admin_or_owner()` RLS branch depends on this flow — which is sound.
- **Mobile H-1 (`create_reservations_from_cart`)** and the DB-level items are unchanged by this repo; remediate them at the database.

## Suggested remediation order (admin-dashboard)

1. **A-1** — `.gitignore` the two secret files immediately; verify with `git check-ignore`.
2. **A-2** — rewrite `.env.example` for the real stack; confirm the legacy Firebase project is locked down/decommissioned.
3. **A-3** — constrain the Cloudinary unsigned preset (or move to signed uploads).
4. **A-5** — remove Firebase migration leftovers once migration is confirmed done.
5. **A-4** — narrow edge-function CORS.
