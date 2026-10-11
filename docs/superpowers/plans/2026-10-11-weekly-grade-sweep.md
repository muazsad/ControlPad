# Weekly Grade Sweep Implementation Plan

Spec: `docs/superpowers/specs/2026-10-11-weekly-grade-sweep-design.md`
Branch: `feat/grade-sweep` (off `main`)

- [ ] 1. **Tests first** — `src/lib/grades/sweep.test.ts` covering every case in
      the spec. Run `npm test`; expect failures (no module yet).
- [ ] 2. **Pure logic** — `src/lib/grades/sweep.ts` (constants,
      `parseGradeInput`, `planSweep`, Eastern-window helpers). Tests green.
- [ ] 3. **Data helper** — `src/lib/grades/sweep-data.ts`: `fetchLatestGrades()`
      with `.range()` paging.
- [ ] 4. **Server action** — `saveGradeSweep` in `src/app/grades/actions.ts`.
- [ ] 5. **Page** — `src/app/grades/sweep/page.tsx` (role gate, two queries,
      row shaping, Eastern "updated recently" flag, progress counts).
      Add `loading.tsx` skeleton.
- [ ] 6. **Client** — `src/app/grades/sweep/sweep-form.tsx` (filters, keyboard
      navigation, validation, save, draft, beforeunload).
- [ ] 7. **Entry point** — "Weekly sweep" button on `/grades` via `PageHeader`
      `action`.
- [ ] 8. **Docs** — `PROJECT_PLAN.md` §3.2 and §9 (October 2026).
- [ ] 9. **Verify** — `npm test && npm run build`; manual keyboard walkthrough
      if a dev database is available.
- [ ] 10. Commit in small steps on the branch.
