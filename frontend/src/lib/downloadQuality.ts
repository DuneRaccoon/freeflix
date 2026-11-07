import type { CatalogTorrentRequest } from '@/types';

/**
 * A quality the download endpoint accepts. A torrent row's or a candidate's `quality` is a
 * free string (a release can say `480p`, `4K` or nothing); anything outside the three the
 * catalog download takes becomes `1080p`, the endpoint's own default.
 *
 * Shared by the web player's source switcher and its next-episode download, so the two
 * cannot disagree about which quality a background request asks for.
 */
export function toDownloadQuality(q: string | null | undefined): CatalogTorrentRequest['quality'] {
  return q === '720p' || q === '1080p' || q === '2160p' ? q : '1080p';
}
