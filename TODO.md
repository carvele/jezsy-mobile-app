# UI/UX Layout Audit & Fix Roadmap

## Approved tasks (Tasks 1–5)

### Task 1 — Accessibility + CTA semantics pass (Critical) ✅

- Files: app/product/[id].tsx, app/cart.tsx, app/checkout.tsx, app/reserve/[id].tsx, app/reservations.tsx, app/notifications.tsx
- Status: Completed (Added accessibility roles, labels, hints, and state mappings across all key user action views).

### Task 2 — Strengthen “Reserve Now” priority & state gating (Critical) ✅

- Status: Completed (Reserve Now is disabled until required size and color options are selected, displaying inline alerts and guidelines).

### Task 3 — Receipt upload gating (Critical) ✅

- File: app/reserve/[id].tsx
- Status: Completed (Receipt status updates dynamically and gates the Confirm Reservation button).

### Task 4 — Checkout date handling improvement (Medium) ✅

- File: app/checkout.tsx
- Status: Completed (Checkout validates YYYY-MM-DD pickup date and prevents booking submission for invalid date formats).

### Task 5 — Replace blocking alerts for cart add (Medium) ✅

- File: app/product/[id].tsx
- Status: Completed (Replaced browser-like blocking alerts with custom, non-blocking floating notifications/toasts when item is added to cart).
