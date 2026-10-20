/**
 * The TV surface carries no `crossOrigin`, anywhere.
 *
 * WHY A SOURCE GUARD IS THE ONLY INSTRUMENT. jsdom fetches neither a media resource nor a
 * text track, so nothing that renders this surface can observe the attribute at all: a
 * `crossOrigin="anonymous"` added to the `<video>` is invisible to all 1400-odd rows of
 * `npm run test:tv` and to `tsc`, and the first thing that would notice is a television that
 * has stopped playing.
 *
 * WHY THE BAN, WITH THE RIGHT REASON — because a ban resting on a wrong reason is one the
 * first person to test it deletes. The subtitle URL and the stream URL are both same-origin
 * through `next.config.ts`'s `/api/*` rewrite, so nothing is needed. What the attribute would
 * DO is switch the media element's own range requests to CORS mode on the recovery ladder's
 * next `load()`, against a backend whose `cors_origins` is an exact-match list holding no LAN
 * address — i.e. it breaks the film, not the subtitles. It is NOT that it drops the cookie:
 * `crossorigin="anonymous"` sets credentials mode `same-origin`, which still sends cookies on
 * a same-origin request.
 *
 * WHERE IT LIVES. Inside `src/app/(bigscreen)/`, because `npm run test:tv` is
 * `vitest run 'src/app/(bigscreen)'` — a DIRECTORY GLOB — so a guard one directory up would
 * be silently absent from the only suite the TV surface has, while still passing under the
 * full `npx vitest run`. Neither suite runs in `next build` or in CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BIGSCREEN_DIR = join(process.cwd(), 'src/app/(bigscreen)');

/**
 * Comments removed, quote-aware. The compact form of `legacy-target.test.ts`'s scanner, and
 * it has to be quote-aware rather than two regexes: a crude `//`-to-end-of-line strip deletes
 * the rest of a line that merely CONTAINS a URL, so a violation sitting after one on the same
 * line would be hidden. The positive controls below include exactly that line.
 *
 * Known limits, inherited: a single-quoted or double-quoted string is ended by a newline too
 * (which is also how JSX text and an apostrophe are handled), and regex literals and nested
 * `${}` are not modelled. Both errors are in the safe direction — a comment gets scanned,
 * never code skipped.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < src.length) {
        out += n;
        i += 2;
        continue;
      }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Both spellings, and that is not belt-and-braces: React's prop is `crossOrigin` on a
 * `<video>`/`<track>`/`<link>`, the DOM property is `crossOrigin`, and the HTML attribute —
 * which is what `setAttribute` and `dangerouslySetInnerHTML` would write — is all-lowercase
 * `crossorigin`. A scan for one of them lets the other through. Case-insensitive rather than
 * two literals so `CrossOrigin` in any casing is caught too.
 */
const FORBIDDEN = /crossorigin/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every non-test source file on the TV surface, with its `(bigscreen)`-relative id. */
function tvSourceFiles(): Array<{ id: string; src: string }> {
  return walk(BIGSCREEN_DIR)
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => ({
      id: relative(BIGSCREEN_DIR, f).split(sep).join('/'),
      src: readFileSync(f, 'utf8'),
    }));
}

describe('the crossOrigin scan itself', () => {
  it('finds every spelling an author could write', () => {
    // THE POSITIVE CONTROL. A guard whose only assertion is "no file matches" is also green
    // when the matcher is broken, which is how a trailing `(` in a banned-name scan on this
    // branch let two live spellings past the one guard a whole stage rested on.
    for (const offence of [
      '<video crossOrigin="anonymous" />',
      '<track crossorigin="use-credentials" />',
      'el.crossOrigin = "anonymous";',
      "video.setAttribute('crossorigin', 'anonymous')",
      '<video CrossOrigin="" />',
    ]) {
      expect.soft(FORBIDDEN.test(stripComments(offence)), offence).toBe(true);
    }
  });

  it('ignores a comment, and is not fooled by a URL on the same line', () => {
    // The first arm is why the scan strips at all: `_data/subtitles.ts` explains in prose why
    // no `crossOrigin` is wanted near the track URL, and a raw-text scan fails on that
    // sentence. The second is why the strip is quote-aware: a `//`-to-end-of-line regex would
    // delete the violation along with the URL that precedes it.
    expect.soft(FORBIDDEN.test(stripComments('// no crossOrigin here, ever\nconst a = 1;'))).toBe(false);
    expect.soft(FORBIDDEN.test(stripComments('/** why no `crossOrigin` */\nconst b = 2;'))).toBe(false);
    expect.soft(
      FORBIDDEN.test(stripComments("const u = 'http://x'; el.crossOrigin = 'anonymous';")),
      'a URL must not hide what follows it',
    ).toBe(true);
  });

  it('is pointed at a directory with files in it', () => {
    // A `walk` that returned nothing would make the ban below vacuous, and the glob this file
    // runs under is a directory glob, so an empty answer is a real failure mode.
    const files = tvSourceFiles();
    expect.soft(files.length, 'the TV surface has sources').toBeGreaterThan(40);
    expect.soft(files.map((f) => f.id)).toContain('_player/SubtitleTrackElement.tsx');
  });
});

describe('the TV surface', () => {
  it('sets no crossOrigin on any element', () => {
    const offenders = tvSourceFiles()
      .filter((f) => FORBIDDEN.test(stripComments(f.src)))
      .map((f) => f.id);
    expect(
      offenders,
      'same-origin through next.config.ts; the attribute switches the MEDIA element’s own '
        + 'range requests to CORS mode against a cors_origins list holding no LAN address',
    ).toEqual([]);
  });
});
