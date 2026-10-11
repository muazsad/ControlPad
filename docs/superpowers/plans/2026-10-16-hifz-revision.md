# Hifz Revision Implementation Plan

Spec: `docs/superpowers/specs/2026-10-16-hifz-revision-design.md`

- [ ] 1. Migration (not applied); `NotificationTrigger` + messages label.
- [ ] 2. `lib/quran/lessons.ts` (types, sabaq filter/total, juz-list parser) + tests.
- [ ] 3. `lib/quran/revision.ts` (juz status, overdue, sabaq-without-revision, SMS text) + tests.
- [ ] 4. Sabaq-only filtering: student-metrics, escalation-data, admin digest, quran slip, student profile, Quran pages.
- [ ] 5. Settings field + validation tests.
- [ ] 6. Bulk form + action (3 inputs, Enter nav, batch insert + juz upsert).
- [ ] 7. `/quran/[studentId]`: juz grid (toggle action), chart revision series.
- [ ] 8. `lib/alerts/revision.ts` + tick wiring + tests.
- [ ] 9. Dashboard, digest, severity, escalation (+ tests); parent last revision.
- [ ] 10. Docs (PROJECT_PLAN §3.4, §3.6, §3.8, §5, §9; DATA_MODEL); `npm test && npm run build`.
