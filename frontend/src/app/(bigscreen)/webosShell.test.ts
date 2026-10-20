/**
 * THE WEBOS SHELL IS FIVE FILES AND NO SUITE CAN RUN IT.
 *
 * `webos/index.html` never executes in any test here: jsdom has no webOS, no launcher, no
 * `window.close()` semantics and no `file://` opaque origin. The IPK is not built either —
 * `ares-package` is not a dependency of this repository and must not become one. So this guard
 * tests the shell as a DOCUMENT: its structure, the one path it fetches, and whether the sizes
 * its manifest declares are the sizes the files actually are.
 *
 * WHY THAT IS WORTH DOING ANYWAY. Every defect it can catch is one whose only other detector is
 * a television that shows a blank screen, a default LG icon, or "Can't reach Freeflix" on a box
 * where everything is running — after a sideload, through a developer-mode session that expires
 * in about 41 days. The cost of a wrong byte here is measured in trips to the set.
 *
 * COMMENTS ARE STRIPPED, AND THE SHELL IS WHY. `index.html`'s own header explains at length that
 * `<script type="module">` is CORS-blocked under `file://` — so the document contains that
 * string twice in prose. A raw-text scan for it reports the shell as broken; a raw-text count of
 * `<script` reports three. This is the same disguise that let a dead stage ship on this branch
 * (see `noDeadExports.test.ts`), in a file that is ten per cent comment by line.
 *
 * WHERE IT LIVES. Under `src/app/(bigscreen)/`, because `npm run test:tv` is a DIRECTORY glob
 * and a guard outside it would be absent from the only suite the TV surface has.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** `process.cwd()` is `frontend/` under vitest; the shell is its sibling. */
const WEBOS = join(process.cwd(), '..', 'webos');

const manifestText = readFileSync(join(WEBOS, 'appinfo.json'), 'utf8');
const manifest = JSON.parse(manifestText) as Record<string, unknown>;
const shellRaw = readFileSync(join(WEBOS, 'index.html'), 'utf8');

/** HTML comments removed. `<!--` … `-->` only; there is no other comment syntax in a document. */
export function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, ' ');
}

const shell = stripHtmlComments(shellRaw);

/**
 * A PNG's real width and height, read from the IHDR rather than from the filename.
 *
 * Bytes 0-7 are the signature, 8-11 the first chunk's length, 12-15 its type (`IHDR`), and
 * 16-23 the two big-endian 32-bit dimensions. Anything else is not a PNG, which is itself worth
 * failing on: webOS wants a PNG and a renamed JPEG shows as a blank tile.
 */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('no IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the scanners themselves', () => {
  it('strips an HTML comment and leaves the markup beside it', () => {
    // The live case: the shell explains the module ban in prose, twice. Without the strip the
    // bans below fire on the sentence that documents them.
    expect.soft(stripHtmlComments('<!-- <script type="module"> is banned --><script>x</script>'))
      .not.toMatch(/type="module"/);
    expect.soft(stripHtmlComments('<!-- a --><script>x</script>')).toMatch(/<script>/);
    expect.soft(stripHtmlComments('<!-- a --> keep <!-- b --> this'), 'several comments')
      .toMatch(/keep\s+this/);
  });

  it('reads a PNG size from the header, and refuses what is not a PNG', () => {
    const real = readFileSync(join(WEBOS, 'icon.png'));
    expect.soft(pngSize(real)).toEqual({ width: 80, height: 80 });
    expect.soft(() => pngSize(Buffer.from('not a png at all, really'))).toThrow(/not a PNG/);
  });
});

describe('appinfo.json', () => {
  it('declares what webOS requires, with the values the spec fixes', () => {
    expect.soft(manifest.id, 'reverse-DNS, and com.palm/com.webos/com.lge are forbidden prefixes')
      .toBe('com.freeflix.tv');
    expect.soft(manifest.type).toBe('web');
    expect.soft(manifest.main, 'must be a relative local file, never a URL — the whole reason a shell exists')
      .toBe('index.html');
    expect.soft(manifest.title).toBe('Freeflix');
    expect.soft(manifest.resolution).toBe('1920x1080');
    expect.soft(manifest.disableBackHistoryAPI).toBe(true);
    expect.soft(manifest.handlesRelaunch).toBe(true);
    expect.soft(String(manifest.version), 'X.Y.Z').toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('carries no field that is dead weight on this webOS', () => {
    // `bgColor`/`bgImage` are webOS 1.x-2.x only, and there is no permissions field for a
    // third-party web app at all — LAN access needs nothing declared. A field that does nothing
    // reads to the next person as a requirement.
    for (const dead of ['bgColor', 'bgImage', 'permissions', 'requiredPermissions']) {
      expect.soft(manifest, dead).not.toHaveProperty(dead);
    }
  });

  it('declares three assets that exist at the sizes webOS expects', () => {
    // THE ASSERTION THAT NEEDS THE HEADER READ. A 130x130 file named icon.png satisfies every
    // string check here and shows wrong in the launcher; the only instrument is the bytes.
    const expected: Array<[string, number, number]> = [
      ['icon', 80, 80],
      ['largeIcon', 130, 130],
      ['splashBackground', 1920, 1080],
    ];
    for (const [field, width, height] of expected) {
      const name = String(manifest[field]);
      const path = join(WEBOS, name);
      expect.soft(existsSync(path), `${field} -> ${name} exists`).toBe(true);
      if (!existsSync(path)) continue;
      expect.soft(pngSize(readFileSync(path)), `${field} is ${width}x${height}`)
        .toEqual({ width, height });
    }
  });
});

describe('the webos/ directory', () => {
  it('is the five files and nothing else, because ares-package ships all of it', () => {
    // `ares-package ./webos` packages the WHOLE directory into the IPK and installs it on the
    // television. The asset generator lived here for one commit and would have gone with it;
    // it is `tools/make-tv-assets.py` now. A helper, a note, a stray export — anything dropped
    // in here reaches the set, so the set of names is pinned rather than described.
    expect(readdirSync(WEBOS).filter((n) => !n.startsWith('.')).sort()).toEqual([
      'appinfo.json',
      'icon.png',
      'index.html',
      'largeIcon.png',
      'splash.png',
    ]);
  });
});

describe('index.html', () => {
  it('loads nothing from outside itself', () => {
    // Under a `file://` opaque origin every one of these is a cross-origin fetch that fails
    // silently, leaving a television on a blank screen with no console to say why.
    expect.soft(shell, 'no module script').not.toMatch(/type\s*=\s*["']module["']/);
    expect.soft(shell, 'no external script').not.toMatch(/<script[^>]+\bsrc\s*=/i);
    expect.soft(shell, 'no stylesheet or font link').not.toMatch(/<link[^>]+\bhref\s*=/i);
    expect.soft(shell, 'no @import').not.toMatch(/@import/);
    expect.soft((shell.match(/<script\b/gi) ?? []).length, 'exactly one script element').toBe(1);
  });

  it('probes the one path that reaches the backend from this origin', () => {
    // `/health` is a route on the BACKEND origin. The browser reaches it only through
    // next.config.ts's `/_backend/:path*` rewrite, so `{server}/health` is a Next 404 page —
    // which `res.ok === false` reports as "Can't reach Freeflix" on a box where everything is
    // running. The design spec says `/health`; it is wrong, and this row is what holds the
    // correction in place.
    expect.soft(shell).toMatch(/['"]\/_backend\/health['"]|\+\s*['"]\/_backend\/health['"]/);
    expect.soft(shell, 'and never the bare spelling').not.toMatch(/fetch\(\s*\w+\s*\+\s*['"]\/health['"]/);
  });

  it('leaves by replacing, into the route that tells the app it is the app', () => {
    expect.soft(shell).toMatch(/location\.replace\(/);
    expect.soft(shell, 'never assign/href: the shell must not be a history entry under disableBackHistoryAPI')
      .not.toMatch(/location\.(assign|href\s*=)/);
    expect.soft(shell).toMatch(/\/bigscreen\?from=app/);
  });

  it('bounds the probe, so a hung socket is not a permanent splash', () => {
    expect.soft(shell).toMatch(/AbortController/);
    expect.soft(shell).toMatch(/TIMEOUT_MS\s*=\s*\d+/);
  });

  it('bakes in no address', () => {
    // A changed Pi address must not mean repackaging and resideloading through a developer-mode
    // session that expires. The only numbers allowed here are the default port and the ranges
    // the validator checks.
    const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    expect.soft(shell.match(ipv4), 'no literal address anywhere in the shell').toBeNull();
    expect.soft(shell, 'the address is read from storage').toMatch(/localStorage\.getItem\(/);
  });

  it('can be driven by a D-pad alone', () => {
    // There is no pointer on this device. Arrow keys, OK, and nothing that needs a mouse.
    for (const code of ['37', '39', '38', '40', '13']) {
      expect.soft(shell, `keyCode ${code}`).toMatch(new RegExp(`\\b${code}\\b`));
    }
    expect.soft(shell, 'focus is visible').toMatch(/:focus/);
    expect.soft(shell, 'and it is an outline, not a composited effect').toMatch(/outline:/);
  });

  it('renders every state the four steps can reach', () => {
    for (const section of ['probing', 'setup', 'failed', 'leaving']) {
      expect.soft(shell, `#${section}`).toMatch(new RegExp(`id="${section}"`));
    }
    expect.soft(shell, 'the failure card offers both ways out').toMatch(/id="retry"/);
    expect.soft(shell).toMatch(/id="change"/);
  });

  it('uses no GPU-expensive effect, for the same reason the TV stylesheet does not', () => {
    // The shell is up for a second, but it is up over a cold compositor on a 2022 panel and it
    // is the first thing the viewer sees.
    for (const banned of [/backdrop-filter/, /mix-blend-mode/, /filter:\s*blur/, /<svg/i]) {
      expect.soft(shell, String(banned)).not.toMatch(banned);
    }
  });
});
