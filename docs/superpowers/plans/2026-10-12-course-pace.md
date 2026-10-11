# Course Pace Implementation Plan

Spec: `docs/superpowers/specs/2026-10-12-course-pace-design.md`
Branch: `feat/course-pace` (stacked on `feat/grade-sweep`)

- [x] 1. Migration `20261012000000_course_pace.sql` (not applied).
- [x] 2. `lib/grades/pace.ts` + tests.
- [x] 3. `sweep.ts` snapshot rules + tests.
- [ ] 4. `lib/grades/pace-data.ts` (shared context loader); `NotificationTrigger` values.
- [ ] 5. Settings: validation + tests, form ("Term & pace"), page select.
- [ ] 6. `lib/alerts/pace.ts` + tests.
- [ ] 7. Actions: `recordGrade`, `saveGradeSweep`, `createCourse`, `updateCourseDates`.
- [ ] 8. Sweep page + grid (3 inputs, grid keys, draft format).
- [ ] 9. Grade form, course form, `/grades/[courseId]` (columns, chart, dates card), student profile pace bars.
- [ ] 10. Student metrics, digest, dashboard, severity, escalation (+ tests).
- [ ] 11. Docs: PROJECT_PLAN 3.2/3.8/5/9, DATA_MODEL.
- [ ] 12. `npm test && npm run build`; PR.
