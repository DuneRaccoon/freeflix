/**
 * The two subtitle calls, driven through the REAL api-client interceptor.
 *
 * WHY THE CLIENT IS NOT MOCKED. `vi.mock('./api-client')` would close the hole this file
 * exists for and leave the real one open: the defect being pinned is that
 * `handleUnauthorized` runs inside apiClient's REJECTION HANDLER, before any caller sees the
 * error, and hard-navigates with `window.location.replace`. A mid-film 401 on a subtitle list
 * would therefore evict the viewer from the film they are watching — for a caption. The
 * nearer precedent is `(bigscreen)/_data/useWatchProgress.allow401.test.tsx`, which carries no
 * `vi.mock` either and records the two facts this harness needs:
 *
 *  1. THE MODULE IS STATEFUL AND POISONS ITS NEIGHBOURS. `redirecting` is module-scoped and
 *     never reset, so one trip through the redirect silences every later 401 in the same
 *     module registry. Each test resets the registry and imports a fresh client.
 *  2. `window.location` MUST BE FULL ENOUGH. axios's own `isURLSameOrigin` builds a
 *     `new URL(location.href)`, so a stub carrying only `pathname` throws "Invalid URL"
 *     before the request is sent.
 *
 * The adapter REJECTS with an axios-shaped error rather than resolving a 401: a custom adapter
 * is the thing that would normally call `settle()`, so resolving would never reach the response
 * interceptor at all and this file would pass while asserting nothing.
 *
 * NOTE ON SCOPE. This file sits in `src/services/`, so it runs under `npx vitest run` and NOT
 * under `npm run test:tv` — that script is `vitest run 'src/app/(bigscreen)'`, a directory
 * glob. The TV-side helpers have their own file inside that directory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosHeaders, type AxiosRequestConfig } from 'axios';

const WATCH_PATH = '/bigscreen/watch/pk';

let realLocation: Location;

beforeEach(() => {
  realLocation = window.location;
  vi.resetModules();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

/**
 * A fresh api-client with every request answered by `answer`, the streaming service bound to
 * it, and a spy on the one call the interceptor would make to take the player out.
 */
async function freshService(answer: (config: AxiosRequestConfig) => Promise<unknown>) {
  const replace = vi.fn();
  const origin = 'http://localhost:3000';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: `${origin}${WATCH_PATH}`,
      origin,
      protocol: 'http:',
      host: 'localhost:3000',
      hostname: 'localhost',
      port: '3000',
      pathname: WATCH_PATH,
      search: '',
      hash: '',
      replace,
      assign: vi.fn(),
      reload: vi.fn(),
      toString: () => `${origin}${WATCH_PATH}`,
    },
  });
  const api = (await import('@/services/api-client')).default;
  const sent: AxiosRequestConfig[] = [];
  api.defaults.adapter = (async (config: AxiosRequestConfig) => {
    sent.push(config);
    return answer(config);
  }) as never;
  // Imported AFTER the client, so it closes over the same fresh instance.
  const { streamingService } = await import('@/services/streaming');
  return { api, sent, replace, streamingService };
}

/** What axios's own adapters hand the response interceptor for a 401. */
function axios401(config: AxiosRequestConfig) {
  const response = { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config };
  return Object.assign(new Error('Request failed with status code 401'), {
    isAxiosError: true,
    config,
    response,
  });
}

const ok = (config: AxiosRequestConfig, data: unknown = null) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});

/** Case-insensitively, whatever shape the headers reached the adapter in. */
const headerOf = (config: AxiosRequestConfig | undefined, name: string) =>
  AxiosHeaders.from(config?.headers as never).get(name);

const emptyList = {
  torrent_id: 'pk',
  state: 'downloading',
  coverage: 'none',
  source: 'session',
  paired_to: null,
  subtitles: [],
};

describe('a subtitle call cannot evict a viewer from a film', () => {
  it('a 401 on the list with the opt-out leaves the player where it is', async () => {
    // The interceptor logs a 401 it was told to expect quietly, but the arm below is a real
    // one and paints the console red; silenced so a reader of this suite's output is not
    // sent after a fault that is this file's own fixture.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sent, replace, streamingService } = await freshService(async (config) => {
      throw axios401(config);
    });

    await expect(
      streamingService.getSubtitles('pk', 4, { allow401: true }),
    ).rejects.toThrow(/401/);

    // The opt-out, as the interceptor reads it.
    expect.soft(sent[0]?.__allow401).toBe(true);
    // And the thing that must NOT have happened: a hard navigation out of the film because a
    // caption list came back unauthorised.
    expect.soft(replace).not.toHaveBeenCalled();
  });

  it('without the opt-out the same 401 DOES navigate, which is why the flag is there', async () => {
    // The non-vacuity half: proof that this fixture can observe the redirect at all. Without
    // it, deleting `__allow401` from the service would leave the arm above green.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { replace, streamingService } = await freshService(async (config) => {
      throw axios401(config);
    });

    await expect(streamingService.getSubtitles('pk', 4)).rejects.toThrow(/401/);

    expect(replace).toHaveBeenCalledWith('/bigscreen/pair');
  });

  it('the admission POST carries the same opt-out', async () => {
    // The POST is the press the viewer just made, so a 401 here is the most likely moment of
    // all to lose them the film.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sent, replace, streamingService } = await freshService(async (config) => {
      throw axios401(config);
    });

    await expect(
      streamingService.fetchSubtitle('pk', 4, { allow401: true }),
    ).rejects.toThrow(/401/);

    expect.soft(sent[0]?.__allow401).toBe(true);
    expect.soft(replace).not.toHaveBeenCalled();
  });

  it('and without it the POST navigates too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { replace, streamingService } = await freshService(async (config) => {
      throw axios401(config);
    });

    await expect(streamingService.fetchSubtitle('pk', 4)).rejects.toThrow(/401/);

    expect(replace).toHaveBeenCalledWith('/bigscreen/pair');
  });
});

describe('the URLs are pinned exactly', () => {
  it('the list is the torrent id, and the episode rides as a param', async () => {
    const { sent, streamingService } = await freshService(async (c) => ok(c, emptyList));

    const list = await streamingService.getSubtitles('pk', 4, { allow401: true });

    expect(list).toEqual(emptyList);
    // `toBe` on the whole path, never `toContain('/subtitles')`: every spelling of the
    // segment satisfies a substring check, so a wrong path would pass one.
    expect.soft(sent[0]?.url).toBe('/streaming/pk/subtitles');
    expect.soft(sent[0]?.baseURL).toBe('/api/v1');
    expect.soft(String(sent[0]?.method).toLowerCase()).toBe('get');
    expect.soft(sent[0]?.params).toEqual({ file_index: 4 });
  });

  it('an absent episode is an ABSENT PARAM, not an undefined one', async () => {
    // `?file_index=undefined` is not a hypothetical: the backend validates the index against
    // the torrent's video files and 404s one that is not among them, and the television's one
    // status->copy map renders that 404 as "The box doesn't recognise this title." Asserted
    // as `undefined` rather than by serialising the query, because axios drops an undefined
    // param silently — so `{ file_index: undefined }` would serialise identically and a
    // query-string assertion could not see the mistake.
    const { sent, streamingService } = await freshService(async (c) => ok(c, emptyList));

    await streamingService.getSubtitles('pk');

    expect.soft(sent[0]?.url).toBe('/streaming/pk/subtitles');
    expect.soft(sent[0]?.params).toBeUndefined();
  });

  it('the admission POST names the index in the path', async () => {
    const { sent, streamingService } = await freshService(async (c) =>
      ok(c, { admitted: 2, budget_ms: 45000 }),
    );

    const result = await streamingService.fetchSubtitle('pk', 4, { allow401: true });

    // `admitted: 0` is a success, so the caller gets the body rather than a boolean.
    expect(result).toEqual({ admitted: 2, budget_ms: 45000 });
    expect.soft(sent[0]?.url).toBe('/streaming/pk/subtitles/4/fetch');
    expect.soft(String(sent[0]?.method).toLowerCase()).toBe('post');
    // The torrent id and the index are in that order, and the index is NOT a row position.
    expect.soft(`${sent[0]?.baseURL}${sent[0]?.url}`).toBe('/api/v1/streaming/pk/subtitles/4/fetch');
  });
});

describe('the list is never read from a cache', () => {
  it('asks for no stored copy', async () => {
    // `ready` flips underneath this URL while a download runs, so a cached 200 is the one
    // answer the television must never believe. The request half is a header because the
    // `fetch`-only `cache` option is inert here: axios 1.12.2 resolves adapters in the order
    // ['xhr', 'http', 'fetch'], so in a browser the XHR adapter runs and reads no `cache`
    // key at all — a `cache: 'no-store'` field in an axios config is a guard that cannot be
    // observed either to work or to be missing.
    const { sent, streamingService } = await freshService(async (c) => ok(c, emptyList));

    await streamingService.getSubtitles('pk', 4, { allow401: true });

    expect(headerOf(sent[0], 'cache-control')).toBe('no-store');
  });
});
