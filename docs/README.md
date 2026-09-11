# Documentation Taxonomy & Architecture Index

This index categorizes all engineering documentation across the \jezsy-mobile-app\ repository according to the lifecycle governance standards established in Phase B7.

---

## 1. Taxonomy Definitions

| Tier | Purpose | Edit Policy |
|---|---|---|
| **NORMATIVE** | Active operational guides, technical contracts, current architectural baselines, and microcopy standards. | Living documentation maintained alongside code changes. |
| **HISTORICAL SNAPSHOT** | Point-in-time design explorations, handoff memos, phase roadmaps, and sprint research records. | Preserved as historical artifacts; not actively updated. |
| **AUDIT LEDGER** | Completed, immutable verification reports, closure ledgers, and formal gate records. | Strictly immutable. Never edit after phase closure. |
| **SUPERSEDED** | Legacy documentation formally replaced by newer normative standards. | Retained for audit trail; marked superseded in this index. |

---

## 2. Document Registry

### Normative Current-State Architecture & Contracts
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Canonical system architecture specification (48 PostgreSQL tables, RLS architecture, MediaPipe pose tracking, PayMongo payments, and frozen B5 messaging).
- [ar-system-contract.md](./ar-system-contract.md) — AR Try-On runtime contracts, Three.js/WebView pipeline, and garment calibration specifications.
- [auth-routing-contract.md](./auth-routing-contract.md) — Authentication flow, routing gates, and session handling invariants.
- [microcopy-standard.md](./microcopy-standard.md) — Standardized user-facing microcopy, error message templates, and tone guidelines.
- [payment-test-guide.md](./payment-test-guide.md) — Operational test guide for electronic and manual payment workflows.
- [paymongo-setup.md](./paymongo-setup.md) — PayMongo webhook setup, webhook secrets, and checkout session configuration.
- [GLB_REQUIREMENTS.md](./GLB_REQUIREMENTS.md) — 3D asset modeling, GLB specifications, and material requirements.
- [stock-check-at-reservation-tradeoffs.md](./stock-check-at-reservation-tradeoffs.md) — Architectural rationale for reservation inventory hold boundaries.
- [supabase-project-state-2026-07-29.md](./supabase-project-state-2026-07-29.md) — Baseline project configuration and database settings reference.

### Completed Immutable Audit Ledgers (\docs/audits/\)
- [audits/b6-verification-closure.md](./audits/b6-verification-closure.md) — Phase B6 Security Hardening, Definer Search Path & Persona RLS Closure Ledger.
- [audits/security-performance-hardening-closure-ledger.md](./audits/security-performance-hardening-closure-ledger.md) — Phase B4 Security & Performance Hardening Closure Ledger.
- [audits/architecture-remediation-program-phase-1.md](./audits/architecture-remediation-program-phase-1.md) — Phase B1-B3 Foundation Remediation Synthesis.
- [audits/architecture-synthesis-ultra-report.md](./audits/architecture-synthesis-ultra-report.md) — Cross-platform architecture synthesis report.
- [audits/mobile-social-layer-user-discovery-audit.md](./audits/mobile-social-layer-user-discovery-audit.md) — Social layer and user discovery technical audit.

### Historical Snapshots & Research Records
- [activity-log.md](./activity-log.md) — Chronological engineering activity log.
- [admin-dashboard-handoff-2026-07-29.md](./admin-dashboard-handoff-2026-07-29.md) — Point-in-time handoff brief for admin dashboard team.
- [admin-dashboard-security-audit-2026-07-23.md](./admin-dashboard-security-audit-2026-07-23.md) — Initial administrative interface security review.
- [backend-security-audit-2026-07-23.md](./backend-security-audit-2026-07-23.md) — Baseline backend security assessment.
- [DB_AUDIT_2026-07-20.md](./DB_AUDIT_2026-07-20.md) & [DB_TABLE_AUDIT_2026-07-20.md](./DB_TABLE_AUDIT_2026-07-20.md) — Initial database audits.
- [DB_IMPLEMENTATION_PLAN.md](./DB_IMPLEMENTATION_PLAN.md) — Historical database migration planning document.
- [ar-filament-experiment.md](./ar-filament-experiment.md) — Technical exploration of Filament rendering engine.
- [ar-fit-tracking-reliability.md](./ar-fit-tracking-reliability.md) — Benchmark data on skeletal landmark tracking reliability.
- [ar-tryon-audit-implementation-plan.md](./ar-tryon-audit-implementation-plan.md) — AR Try-On phased implementation roadmap.
- [ar-tryon-garment-reality-report.md](./ar-tryon-garment-reality-report.md) — Fidelity assessment of 3D garment rendering.
- [ar-tryon-implementation-roadmap.md](./ar-tryon-implementation-roadmap.md) — AR feature delivery schedule.
- [ar-tryon-physical-verification-checklist.md](./ar-tryon-physical-verification-checklist.md) — Physical garment fitting verification checklist.
- [architecture-conversation-record-sept-2026.md](./architecture-conversation-record-sept-2026.md) & [architecture-record-sept-2026.md](./architecture-record-sept-2026.md) — September 2026 architecture alignment sessions.
- [current-ar-state.md](./current-ar-state.md) — Point-in-time snapshot of AR subsystem.
- [essembl-wardrobe-gap-scoping.md](./essembl-wardrobe-gap-scoping.md) — Gap analysis against reference wardrobe architectures.
- [free-tier-audit.md](./free-tier-audit.md) — Supabase free-tier resource utilization audit.
- [pos-architecture-review-sept-2026.md](./pos-architecture-review-sept-2026.md) — Point of sale subsystem architecture review.
- [thesis-alignment-report.md](./thesis-alignment-report.md) — Academic alignment and system design documentation.
- [token-sweep-remaining-plan.md](./token-sweep-remaining-plan.md) — Hardcoded token sweep remediation plan.
- [walk-in-sales-walkthrough.md](./walk-in-sales-walkthrough.md) — POS walk-in sales scenario walkthrough.
- [completion-plan.md](./completion-plan.md) — Phase completion tracking checklist.
