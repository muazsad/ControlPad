# Hifz Revision Implementation Plan

Spec: `docs/superpowers/specs/2026-10-16-hifz-revision-design.md`

- [x] 1. Migration (not applied); `NotificationTrigger` + messages label.
- [x] 2. `lib/quran/lessons.ts` (types, sabaq filter/total, juz-list parser) + tests.
- [x] 3. `lib/quran/revision.ts` (juz status, overdue, sabaq-without-revision, SMS text) + tests.
- [x] 4. Sabaq-only filtering: student-metrics, escalation-data, admin digest, quran slip, student profile, Quran pages.
- [x] 5. Settings field + validation tests.
- [x] 6. Bulk form + action (3 inputs, Enter nav, batch insert + juz upsert).
- [x] 7. `/quran/[studentId]`: juz grid (toggle action), chart revision series.
- [x] 8. `lib/alerts/revision.ts` + tick wiring + tests.
- [x] 9. Dashboard, digest, severity, escalation (+ tests); parent last revision.
- [x] 10. Docs (PROJECT_PLAN §3.4, §3.6, §3.8, §5, §9; DATA_MODEL); `npm test && npm run build`.
