/**
 * Parse a timestamp the backend sent as NAIVE UTC.
 *
 * Every `DateTime` column in this schema is declared without `timezone=True`, so
 * Postgres drops the tzinfo and the value serialises with no zone suffix
 * (`"2026-09-22T08:00:00"`). Per the ECMAScript spec a date-time string without a zone
 * is interpreted as LOCAL time, so `new Date()` on it silently shifts by the viewer's
 * UTC offset — an invite advertised as open until 08:00 actually dies at 04:00 for a
 * reader in New York, who then hits the "expired" screen well inside the window they
 * were shown.
 *
 * Appending `Z` when no offset is present pins it to UTC. Values that already carry a
 * zone are left alone.
 */
export const parseUtc = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const normalised = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
};
