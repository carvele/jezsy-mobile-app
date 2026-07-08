# UI/UX Layout Audit & Fix Roadmap

## Approved tasks (Tasks 1–5)

### Task 1 — Accessibility + CTA semantics pass (Critical)

- Files: app/product/[id].tsx, app/cart.tsx, app/checkout.tsx, app/reserve/[id].tsx, app/reservations.tsx, app/notifications.tsx
- Steps:
  - Add accessibilityRole/Label/Hint to all major CTAs and destructive buttons.
  - Ensure disabled buttons expose accessibilityState={{ disabled: true }}.
- Acceptance criteria:
  - Primary action buttons are screen-reader labeled and announce disabled/enabled correctly.
  - No unlabeled destructive/icon-only actions remain.

Status: Not started

### Task 2 — Strengthen “Reserve Now” priority & state gating (Critical) ✅

- Implemented gating + accessibility for Reserve Now (Task 2).

- Steps:
  - Disable “Reserve Now” until required selections are ready.
  - Add inline guidance + accessibility labels.
- Acceptance criteria:
  - Reserve Now can’t be pressed in an invalid state.

Status: In progress (Task 2)

### Task 3

- File: app/reserve/[id].tsx
- Steps:
  - Add inline “Receipt uploaded” status / required hint.
  - Tie primary CTA disabled state to prerequisites.
- Acceptance criteria:
  - Users understand missing requirements before pressing Confirm Reservation.

Status: Not started

### Task 4 — Checkout date handling improvement (Medium)

- File: app/checkout.tsx
- Steps:
  - Validate pickupDate format (YYYY-MM-DD) and prevent Pay Deposit until valid.
- Acceptance criteria:
  - Invalid dates prevent CTA.

Status: Not started

### Task 5 — Replace blocking alerts for cart add (Medium)

- File: app/product/[id].tsx
- Steps:
  - Remove alert('Added to Bag!') and replace with non-blocking feedback.
- Acceptance criteria:
  - Feedback without interrupting flow.

Status: Not started
