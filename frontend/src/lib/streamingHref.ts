import type { TorrentStatus } from '@/types';

/**
 * The player link for a download. `file_index` names the episode inside a season pack
 * the server reused for a Play press; it is appended whenever it is a number, 0 included.
 *
 * Lives in `@/lib`, not `@/utils/streaming`, because the TV component tests mock
 * `@/utils/streaming` wholesale.
 */
export function streamingHref(s: Pick<TorrentStatus, 'id' | 'file_index'>): string {
  const base = `/streaming/${s.id}`;
  return typeof s.file_index === 'number' ? `${base}?file=${s.file_index}` : base;
}
