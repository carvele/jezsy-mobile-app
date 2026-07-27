# CLAUDE.md

Guidance for Claude Code working with code in this repo.

## General Principles

- Generate concise, short solutions for new modules or code.
- Watch for over-engineering, oversized files needing refactor.
- Watch for weird syntax/style mismatching rest of codebase.
- Watch for obvious bugs.
- Prioritize concise, precise code and docs changes.
- No emojis or special characters in comments.
- Write `activity-log.md` in `/docs` to refer back to if confused.
- Make a to-do list; run major changes by user first.
- Review existing files before refactor or change.
- Markdown files use kebab-case naming (e.g. `some-description-changes.md`).
- Don't auto-commit activity logs and docs.
- Comments: one-liner, one sentence.

## Code Quality

- Use the right data structures and algorithms for the problem.
- Don't expose data needlessly (least privilege).
- No external libraries unless absolutely necessary.
- Use the project dependency file for correct versions.
- Avoid redundancy unless it improves usability.
- Prioritize native React Native performance (use `useMemo`/`useCallback` when necessary, and prefer Expo's standard libraries over third-party npm packages).

## Version Control

- Commit after significant changes, with clear messages.
- Keep commits focused, atomic.
- No auto-push of any branch.
- One feature per branch off main; stack dependent features and state the base branch in the commit body.
- Avoid multiple in-flight branches editing the same file; if unavoidable, keep the edits in distinct regions to limit merge conflicts.

## Database & Migrations

- The Supabase DB is shared and live: the admin-dashboard repo and a co-worker apply to it too. Coordinate schema changes.
- Every schema change is a file in `supabase/migrations/` with a matching `.rollback.sql`; do not rely on ad-hoc SQL.
- After applying a migration, re-sync the migration ledger (apply can drift ledger versions) and regenerate `src/types/database.types.ts`.
- Prefer SECURITY INVOKER RPCs that write least-privilege columns; verify grants with `has_function_privilege` (REVOKE FROM anon alone can no-op due to the PUBLIC default grant).

## AI Restrictions

- No customer personal data - names, contacts, account numbers, transactions (unless approved exemptions).
- No credentials - passwords, API keys, tokens, connection strings.
