import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const PUBLIC = join(__dirname, '../../../public');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const { strategyFor } = createRequire(import.meta.url)(join(PUBLIC, 'sw.js')) as {
  strategyFor: (req: Request, origin: string) => string | null;
};

/** A PNG's real width x height, from its IHDR chunk. */
function pngSize(path: string): string {
  const buf = readFileSync(path);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('manifest.webmanifest', () => {
  it('is installable: standalone, a start_url, and both a 192 and a 512 icon', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('declares every icon at the size the file really is', () => {
    const icons = [
      ...manifest.icons,
      ...manifest.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons),
    ] as { src: string; sizes: string }[];
    for (const icon of icons) {
      const file = join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file), icon.src).toBe(icon.sizes);
    }
  });

  it('points shortcuts at routes that exist', () => {
    for (const { url } of manifest.shortcuts as { url: string }[]) {
      expect(existsSync(join(__dirname, '../../app/(web)', url, 'page.tsx')), url).toBe(true);
    }
  });
});

describe('sw.js strategyFor', () => {
  const origin = 'https://fre.example';
  const req = (path: string, { mode, ...init }: Omit<RequestInit, 'mode'> & { mode?: string } = {}) => {
    const r = new Request(origin + path, init);
    // `mode: 'navigate'` cannot be passed to the constructor — only the browser makes one.
    if (mode) Object.defineProperty(r, 'mode', { value: mode });
    return r;
  };

  it('never intercepts the backend — auth, per-profile data and video streams', () => {
    expect(strategyFor(req('/api/v1/streaming/abc/stream?file=2'), origin)).toBeNull();
    expect(strategyFor(req('/api/v1/auth/session'), origin)).toBeNull();
    expect(strategyFor(req('/_backend/health'), origin)).toBeNull();
    expect(strategyFor(req('/api/v1/movies', { mode: 'navigate' }), origin)).toBeNull();
  });

  it('never intercepts a Range request, wherever it points', () => {
    expect(strategyFor(req('/_next/static/x.js', { headers: { range: 'bytes=0-' } }), origin)).toBeNull();
  });

  it('never intercepts a write, another origin, or the TV surface', () => {
    expect(strategyFor(req('/_next/static/x.js', { method: 'POST' }), origin)).toBeNull();
    expect(strategyFor(new Request('https://image.tmdb.org/t/p/w500/a.jpg'), origin)).toBeNull();
    expect(strategyFor(req('/bigscreen', { mode: 'navigate' }), origin)).toBeNull();
    expect(strategyFor(req('/bigscreen/profiles', { mode: 'navigate' }), origin)).toBeNull();
  });

  it('caches hashed build assets and icons, and only falls back for pages', () => {
    expect(strategyFor(req('/_next/static/chunks/app-abc123.js'), origin)).toBe('cache-first');
    expect(strategyFor(req('/icons/icon-192.png'), origin)).toBe('stale-while-revalidate');
    expect(strategyFor(req('/movies', { mode: 'navigate' }), origin)).toBe('network-first');
    // A /bigscreenish route is not the TV surface.
    expect(strategyFor(req('/bigscreenish', { mode: 'navigate' }), origin)).toBe('network-first');
    expect(strategyFor(req('/_next/image?url=x'), origin)).toBeNull();
  });
});
