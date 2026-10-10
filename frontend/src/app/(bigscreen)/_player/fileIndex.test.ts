/**
 * The arrival's `?file=` and the stream URL built from it.
 *
 * THE HAZARD IS A SILENT WRONG EPISODE, so the table below is mostly about what must NOT
 * come out of `fileIndex`. `watchHref` is the only builder of a watch URL on this surface
 * and it uses `!= null` because file 0 is the first file of a season pack; the reader has
 * to mirror that, and `null` must never be what a miss answers.
 *
 * THE SEAM TEST (`no null and no NaN survives either consumer`) is the one that pins the
 * damage rather than the shape. It runs every bare arrival through the REAL
 * `getStreamingUrl` and the REAL `getStreamingInfo`, because the two escape differently and
 * only one of them is loud:
 *
 *   - `getStreamingUrl` gates on `!== undefined`, so a `null` becomes the literal
 *     `?file_index=null` -> a 422 with a JSON body handed straight to the decoder.
 *   - `getStreamingInfo` hands it to axios, which DROPS a null param — so `/info` silently
 *     resolves `max(files, key=size)` and answers THAT file's `content_id`/`season`/
 *     `episode`, which the progress heartbeat then writes. Nothing is logged, nothing
 *     fails, and the viewer's history gains an episode they did not watch.
 *
 * Both consumers are the real modules, with only the axios instance replaced: a test that
 * re-spelled the params expression locally would be asserting its own copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api-client', () => ({ default: { get: vi.fn() } }));

import apiClient from '@/services/api-client';
import { streamingService } from '@/services/streaming';
import { fileIndex, streamSrc } from './fileIndex';
import { watchHref } from '../_data/watchHref';

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: {} });
});

/** Every arrival that must answer "no file", with why it is in the list. */
const BARE: Array<[string, string | null | undefined]> = [
  ['no query at all', undefined],
  ['a null param', null],
  // `Number('') === 0`, and the WEB page maps its equivalent to 0 — so a truncated URL
  // there plays the first file. Here it must mean "no file chosen".
  ['?file= with nothing after it', ''],
  ['whitespace only (Number(" ") is also 0)', '   '],
  ['a word', 'abc'],
  ['the string NaN', 'NaN'],
  ['the string Infinity', 'Infinity'],
  ['a fraction', '1.5'],
  ['negative', '-1'],
  ['negative zero-ish', '-0.0001'],
  // Number.isInteger says yes to 1e21, and String(1e21) is '1e+21' — not a decimal
  // integer, so it reaches the backend as a 422 with a JSON body: exactly the failure
  // this module exists to prevent. Number.isSafeInteger is what refuses it.
  ['past the safe-integer range', '1e21'],
];

describe('fileIndex', () => {
  it('reads a real index, zero included', () => {
    expect(fileIndex('0')).toBe(0);
    expect(fileIndex('3')).toBe(3);
    expect(fileIndex('7')).toBe(7);
  });

  it('file 0 is a real index, not "no file"', () => {
    // The row `watchHref.test.ts:13` pins on the other side of the round trip. A
    // truthiness check here plays episode 1 of a pack when episode 1 was asked for —
    // silently, because `/info` resolves the largest file and the heartbeat writes its
    // content_id.
    expect(fileIndex('0')).toBe(0);
    expect(fileIndex('0')).not.toBeUndefined();
  });

  it.each(BARE)('%s -> undefined', (_why, raw) => {
    expect(fileIndex(raw)).toBeUndefined();
  });

  it('never answers null, and never answers NaN', () => {
    // The two values the type `number | undefined` forbids and JavaScript hands out
    // anyway. Asserted over the whole table, not per row, so a new row cannot be added
    // without this holding for it.
    for (const [, raw] of BARE) {
      const idx = fileIndex(raw);
      expect(idx).toBeUndefined();
      expect(idx).not.toBeNull();
    }
    for (const raw of ['0', '3', '10000']) {
      const idx = fileIndex(raw);
      expect(typeof idx).toBe('number');
      expect(Number.isSafeInteger(idx)).toBe(true);
      expect(idx as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('round-trips the only builder of the URL it reads', () => {
    // fileIndex consumes what watchHref produces, so the pair is pinned together: a
    // divergence in either direction is a wrong episode. `?file=` is the whole query on
    // these URLs, so reading it back is a split rather than a URL parse.
    for (const i of [0, 1, 7, 10000]) {
      const href = watchHref('t-1', i);
      const raw = new URL(href, 'http://tv.test').searchParams.get('file');
      expect(fileIndex(raw), href).toBe(i);
    }
    const bare = new URL(watchHref('t-1'), 'http://tv.test').searchParams.get('file');
    expect(fileIndex(bare)).toBeUndefined();
  });
});

describe('streamSrc', () => {
  it('carries the index when there is one, and nothing when there is not', () => {
    expect(streamSrc('t-1', 3)).toBe('/api/v1/streaming/t-1/video?file_index=3');
    expect(streamSrc('t-1', 0)).toBe('/api/v1/streaming/t-1/video?file_index=0');
    expect(streamSrc('t-1')).toBe('/api/v1/streaming/t-1/video');
    expect(streamSrc('t-1', undefined)).toBe('/api/v1/streaming/t-1/video');
  });

  it('passes no quality, ever', () => {
    // /video accepts `quality` and never reads it (streaming.py), so sending it changes
    // the URL — and therefore any cache key, and the `src` the recovery ladder reloads —
    // for nothing.
    for (const url of [streamSrc('t-1', 3), streamSrc('t-1'), streamSrc('t-1', 0)]) {
      expect(url).not.toContain('quality');
      expect(url).not.toContain('&');
    }
    expect(streamSrc('t-1', 3)!.split('?')[1]).toBe('file_index=3');
  });

  it('answers null for no torrent rather than a URL to nothing', () => {
    expect(streamSrc('')).toBeNull();
    expect(streamSrc(null)).toBeNull();
    expect(streamSrc(undefined, 3)).toBeNull();
  });

  it('is byte-identical to getStreamingUrl, which it deliberately does not import', () => {
    // THE DRIFT PIN. `_player/` may not import `@/services/streaming`
    // (`engineContract.test.ts`: apiClient's rejection interceptor hard-navigates to
    // /bigscreen/pair from inside its own handler, so nothing in the player engine may
    // pull that module into its graph), so the string is built here instead of delegated.
    // This is the house answer to a copy — the same shape as `_data/railsDrift.test.ts`
    // and the TV token pin: copy, then pin it value-for-value inside `test:tv`.
    //
    // Total, not a sample: the second argument is `quality` and stays undefined, and the
    // third takes every value `fileIndex` can produce plus the ids that answer null.
    for (const id of ['t-1', 'abc123', '']) {
      for (const i of [undefined, 0, 1, 7, 10000]) {
        expect(streamSrc(id, i), `${id}/${i}`).toBe(
          streamingService.getStreamingUrl(id, undefined, i),
        );
      }
    }
  });
});

describe('no null and no NaN survives either consumer', () => {
  // `expect.soft` THROUGHOUT, and that is the point. Both consumers receive the same
  // value, so any mutation that lets a `null` or a `NaN` out breaks both halves — and with
  // hard assertions the first failure ends the test before the axios half is ever
  // evaluated, leaving the SILENT escape asserted by a line that never runs. Soft
  // assertions evaluate both and report both, which is the only way one test can prove it
  // pins two failure modes.
  it.each(BARE)('%s reaches neither route as a value', async (_why, raw) => {
    const idx = fileIndex(raw);

    // 1. The LOUD escape: `?file_index=null` -> a 422 with a JSON body fed to the <video>
    // decoder, which reports it as corrupt media.
    const url = streamSrc('t-1', idx);
    expect.soft(url).toBe('/api/v1/streaming/t-1/video');
    expect.soft(url).not.toContain('file_index');
    expect.soft(String(url)).not.toContain('null');
    expect.soft(String(url)).not.toContain('NaN');
    // Through the real builder too, so the assertion holds at the seam and not only
    // against this surface's copy of it.
    expect.soft(streamingService.getStreamingUrl('t-1', undefined, idx)).toBe(
      '/api/v1/streaming/t-1/video',
    );

    // 2. The SILENT escape: axios drops a null param, so /info resolves the largest file
    // and answers its content_id — which the heartbeat writes. The request must carry no
    // `file_index` key at all, not a key with an empty value.
    await streamingService.getStreamingInfo('t-1', idx);
    expect.soft(get).toHaveBeenCalledWith('/streaming/t-1/info', undefined);
    const config = get.mock.calls[0][1] as { params?: Record<string, unknown> } | undefined;
    expect.soft(config?.params).toBeUndefined();
    expect.soft(JSON.stringify(config ?? null)).not.toContain('file_index');
  });

  it('a real index does reach both routes, zero included', async () => {
    // The other half of the seam: a reader that answered undefined for everything would
    // pass every row above.
    for (const i of [0, 3]) {
      get.mockClear();
      const idx = fileIndex(String(i));
      expect(streamSrc('t-1', idx)).toBe(`/api/v1/streaming/t-1/video?file_index=${i}`);
      await streamingService.getStreamingInfo('t-1', idx);
      expect(get).toHaveBeenCalledWith('/streaming/t-1/info', { params: { file_index: i } });
    }
  });
});

describe("/info's stream_url is not the source of the src", () => {
  it('is self-inconsistent on exactly the arrival allowed to be bare', () => {
    // streaming.py builds `stream_url` by appending `?file_index=` only when the CALLER
    // passed one, while the sibling `file_index` reports the RESOLVED index. So on a bare
    // arrival to a season pack the two disagree: stream_url plays whatever /video resolves
    // (the largest file) while `file_index` names the file /info measured and described.
    // Trusting stream_url there is how the heartbeat's content_id and the bytes on screen
    // come from two different episodes.
    const info = {
      // What the backend sends for GET /streaming/t-1/info with no file_index.
      file_index: 2,
      video_file: { stream_url: '/api/v1/streaming/t-1/video' },
    };
    expect(info.video_file.stream_url).not.toContain('file_index');
    expect(streamSrc('t-1', info.file_index)).toBe('/api/v1/streaming/t-1/video?file_index=2');
    expect(streamSrc('t-1', info.file_index)).not.toBe(info.video_file.stream_url);
  });
});
