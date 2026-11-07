-- Which part of a juz was revised: sabaq para and dhor rows record a page
-- range counted within the juz (page 1 = its first page), so any mushaf
-- printing works. 30 matches JUZ_PAGE_MAX in src/lib/quran/lessons.ts.
-- Additive: older rows keep null pages. The app requires pages on new
-- revision rows; the database only checks the values are sane.

alter table quran_progress
  add column from_page smallint,
  add column to_page smallint,
  add constraint quran_progress_pages_paired
    check ((from_page is null) = (to_page is null)),
  add constraint quran_progress_pages_range
    check (from_page between 1 and 30 and to_page between from_page and 30),
  add constraint quran_progress_pages_revision_only
    check (from_page is null or (lesson_type <> 'sabaq' and juz is not null));
