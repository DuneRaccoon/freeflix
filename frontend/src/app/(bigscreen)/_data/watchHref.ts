/**
 * The watch URL for a torrent, with `?file=` when a file inside it was chosen.
 * `!= null`, not truthiness: file 0 is the first file of a season pack. Its own module so
 * a screen test that mocks `title` does not take the URL builder away with it.
 */
export const watchHref = (torrentId: string, fileIndex?: number | null): string =>
  fileIndex != null ? `/bigscreen/watch/${torrentId}?file=${fileIndex}` : `/bigscreen/watch/${torrentId}`;
