# CLAUDE.md

Guidance for Claude Code working with code in this repo.

## General Principles

- Generate concise, short solutions for new modules or code.
- Avoid over-engineering and oversized files; refactor when necessary.
- Maintain consistent syntax and style with the rest of the codebase.
- Watch for obvious bugs and logic errors.
- Prioritize concise, precise code and documentation changes.
- No emojis or special characters in comments.
- Write `activity-log.md` in `/docs` to refer back to if confused.
- Make a to-do list for multi-step work; confirm scope before large or architectural changes. Once a plan is agreed (or the user gives blanket authorization, e.g. "agent decide"), proceed without re-asking at each step.
- Review existing files before refactor or change.
- Markdown files use kebab-case naming (e.g. `some-description-changes.md`).
- Don't auto-commit activity logs and docs.
- Comments: one-liner, one sentence, only when the WHY is non-obvious.

## Code Quality

- Use the right data structures and algorithms for the problem.
- Apply least privilege: don't expose data needlessly.
- No external libraries unless absolutely necessary.
- Use the project dependency file for correct versions.
- Avoid redundancy unless it improves usability.
- Prioritize native React Native performance:
  - Use `useMemo`/`useCallback` when necessary.
  - Prefer Expo's standard libraries over third-party npm packages.
  - Profile before optimizing; avoid premature optimization.

## Platform

- Expo with a **dev client and prebuild (CNG)** — not Expo Go. `android/` is generated and gitignored; there is no committed `ios/`. Run with `expo run:android`, not `expo start` against Expo Go.
- Three third-party native modules are in use and are load-bearing: `react-native-vision-camera`, `react-native-mediapipe-posedetection`, `react-native-worklets-core`. Body scan and AR try-on depend on them.
- Consequence: any feature touching camera, pose, or worklets cannot be verified in Expo Go, and code paths must degrade safely when native modules are absent (see `src/utils/pushNotifications.ts` for the lazy-import + try/catch pattern).
- Adding another native module is a real cost (rebuild, dev-client redistribution). Confirm with the user first, and prefer an Expo standard library where one exists.

## Verification

- No automated test suite is configured in this repo (no `test` script, no Jest/Testing Library). Don't scaffold one unprompted — verify changes with `npx tsc --noEmit` and `eslint` instead, and for UI changes, a manual/browser check per the run instructions.
- Update `README.md` or relevant `/docs` files when a change alters setup steps or a documented workflow.

## Version Control

- Commit after significant changes, with clear, descriptive messages.
- Match the repo's existing convention: `type(scope): imperative summary` (e.g. `feat(ar-tryon):`, `fix(security):`, `chore(types):`), body explains the why.
- Keep commits focused, atomic.
- No auto-push of any branch.
- One feature per branch off main; stack dependent features and state the base branch in the commit body.
- Avoid multiple in-flight branches editing the same file; if unavoidable, keep the edits in distinct regions to limit merge conflicts.

## Database & Migrations

- The Supabase DB is shared and live: the admin-dashboard repo and a co-worker apply to it too. Coordinate schema changes.
- There is no staging environment — migrations apply directly to the shared live DB. Write idempotent SQL (`IF NOT EXISTS`, `CREATE OR REPLACE`) so a re-apply or ledger drift is never destructive.
- Confirm with the user before applying a migration, unless they've already authorized it for the session.
- Every schema change is a file in `supabase/migrations/` with a matching `.rollback.sql`; do not rely on ad-hoc SQL.
- After applying a migration, re-sync the migration ledger (apply can drift ledger versions) and regenerate `src/types/database.types.ts`.
- Prefer SECURITY INVOKER RPCs that write least-privilege columns; verify grants with `has_function_privilege` (REVOKE FROM anon alone can no-op due to the PUBLIC default grant).
- Exception, and check for it: an INVOKER RPC whose target table has an admin-only INSERT/UPDATE policy will fail closed for customers, silently. `create_reservation` shipped this way and blocked every customer reservation. When an RPC *is* the trusted customer write path, it must be SECURITY DEFINER with its own guards — auth check, caller-derived owner id, server-side price resolution — as `create_order` does. Match the RPC's security mode to the policy it has to satisfy.

## AI Restrictions

- No customer personal data - names, contacts, account numbers, transactions (unless approved exemptions).
- No credentials - passwords, API keys, tokens, connection strings.
