/**
 * compareValues — canonical sort comparator for all admin list views.
 *
 * Replaces the identical 3-line block that appeared in useCompanyList,
 * useReviewsList, and useGeneralFixesList. Value extraction (field picking,
 * type coercion, lowercasing) stays in each hook; direction logic lives here.
 */
export function compareValues(
  av: string | number,
  bv: string | number,
  dir: 'asc' | 'desc',
): number {
  if (av < bv) return dir === 'asc' ? -1 : 1
  if (av > bv) return dir === 'asc' ? 1 : -1
  return 0
}
