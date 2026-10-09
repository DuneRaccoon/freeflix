/**
 * The watch URL for a torrent, with `?file=` when a file inside it was chosen.
 * `!= null`, not truthiness: file 0 is the first file of a season pack. Its own module so
 * a screen test that mocks `title` does not take the URL builder away with it.
 *
 * THE ONLY BUILDER of a watch URL on this surface. Continue Watching's resume cards used to
 * carry a byte-for-byte copy of it (predating this module), and a journey test proved that
 * drift was live by spelling one of them `&file=`. Everything that sends the viewer to a
 * file now goes through here.
 *
 * And deliberately NOT `resumeUrlFor` from `@/lib/contentId`, which answers `/streaming/{id}`:
 * a (web) route, which would navigate the television out of its own root layout.
 */
export const watchHref = (torrentId: string, fileIndex?: number | null): string =>
  fileIndex != null ? `/bigscreen/watch/${torrentId}?file=${fileIndex}` : `/bigscreen/watch/${torrentId}`;
