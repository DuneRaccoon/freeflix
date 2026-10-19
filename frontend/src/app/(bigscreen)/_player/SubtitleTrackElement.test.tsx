/**
 * The one `<track>`: its mount gate, its two `kind` arms, its key, and its error prop.
 *
 * WHY THE ELEMENT HAS ITS OWN SUITE AT ALL. The route cannot reach a CHOSEN sidecar yet —
 * the picker is a later task and the transport cell's press is a committed no-op whose own
 * row pins that pressing it changes the cell's state not at all — so every rule below would
 * be unreachable if the element were four lines inside `page.tsx`'s `<video>`. What is left
 * of the composition is pinned in `bigscreen/watch/[id]/page.track.test.tsx`: that the one
 * mount sits INSIDE the `<video>`, that it is not mapped over a list, and that the route
 * renders no track in any state it can reach today.
 *
 * TWO LIMITS, WRITTEN DOWN RATHER THAN LEFT TO BE DISCOVERED.
 *
 *  1. THESE ROWS PROVE THE ELEMENT, NOT THE CUES. jsdom 25.0.1 implements no text-track
 *     machinery: `window.TextTrack` is undefined, `video.textTracks` is a plain zero-length
 *     array even with a `<track default>` child present, `trackEl.track` is undefined and
 *     `trackEl.readyState` is a hardcoded 0. So "unmounted while reloading" is proved as the
 *     element's ABSENCE and never as "no duplicate cues paint" — reading 35 is the only
 *     instrument for the second claim, and it is why nothing here branches on `readyState`.
 *  2. THE FIXTURE'S `url` IS DELIBERATELY NOT THE URL THE ELEMENT SHOULD BUILD. The backend
 *     sends the same string today, so a fixture that agreed with it could not tell "built
 *     from the torrent's own file index" from "trusted the wire field". `video_index` is a
 *     third different number for the same reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SubtitleTrack } from '@/types';
import { subtitleTrackSrc } from '../_data/subtitles';
import { SubtitleTrackElement } from './SubtitleTrackElement';

const TORRENT = 'pk';

/**
 * One wire row, with every number that could be confused for another made different:
 * `index` 9 (the torrent's own file index, which is what the URL is built from),
 * `video_index` 2 (the paired video), and a `url` that is NOT what the element must emit.
 */
function row(index: number, over: Partial<SubtitleTrack> = {}): SubtitleTrack {
  return {
    index,
    video_index: 2,
    // Not a real rung. `naming.track_label` has already folded the rung into `label`, the
    // taxonomy grows, and nothing on this surface may read this field — a value no build has
    // ever heard of is the instrument for that.
    pair_source: 'a-rung-this-build-has-never-heard-of',
    season: 1,
    episode: 1,
    lang: 'en',
    label: 'English',
    flags: [],
    format: 'srt',
    size: 40960,
    ready: true,
    convertible: true,
    reason: null,
    // THE WRONG ANSWER ON PURPOSE: see limit 2 in the header.
    url: `/api/v1/streaming/${TORRENT}/subtitles/not-the-index`,
    ...over,
  };
}

interface HostProps {
  chosen: SubtitleTrack | null;
  reloading?: boolean;
  onUnreadable?: () => void;
  /** The `<video>`'s own handler, so the bubbling hazard below has a witness. */
  onVideoError?: () => void;
}

/** The production shape: the element is a CHILD of the media element, never a sibling. */
function Host({ chosen, reloading = false, onUnreadable = () => {}, onVideoError }: HostProps) {
  return (
    <video onError={onVideoError}>
      <SubtitleTrackElement
        torrentId={TORRENT}
        chosen={chosen}
        reloading={reloading}
        onUnreadable={onUnreadable}
      />
    </video>
  );
}

const tracks = () => [...document.querySelectorAll('track')];
const one = () => {
  const found = tracks();
  expect(found, 'exactly one <track>').toHaveLength(1);
  return found[0];
};

describe('the one <track>', () => {
  it('renders exactly one element, with every attribute pinned', () => {
    render(<Host chosen={row(9)} />);
    const el = one();
    // `getAttribute`, not `el.src`: jsdom absolutises the property, so `el.src` reads
    // `http://localhost:3000/api/...` and a `toBe` against the path would never pass — the
    // house idiom for every URL assertion on this surface.
    expect.soft(el.getAttribute('src'), 'the torrent’s own file index').toBe(
      `/api/v1/streaming/${TORRENT}/subtitles/9`,
    );
    // AN ABSOLUTE ANCHOR AND AN IMPORTED ONE, both, which is `engineContract.test.ts`'s
    // idiom for the recovery ladder and it catches two different things here. The literal
    // above fails if the element follows a change to `subtitleTrackSrc`; this one fails if
    // the element stops following it — a hardcoded copy of today's string, which is green
    // against the literal for exactly as long as the helper does not move. MEASURED: with
    // the element hardcoding the string and the helper's format changed, only this row
    // reddens.
    expect.soft(el.getAttribute('src')).toBe(subtitleTrackSrc(TORRENT, 9));
    // TWO `not.toBe` ROWS REFUSED, AND NAMED SO THEY ARE NOT ADDED BACK — one against
    // `subtitleTrackSrc(TORRENT, 2)` (the paired video's index) and one against the wire
    // `url`. They were shipped with a comment saying they were "not merely implied by the
    // row above"; they are. `toBe('…/subtitles/9')` implies `not.toBe` of every other
    // string, and both refused values differ from it, so no mutation can redden either row
    // while the exact-value row above stays green. MEASURED: with the src built from
    // `video_index` the exact-value row and the non-equality row fail together, and there is
    // no mutation for which the non-equality row is the instrument. What those two swaps
    // rest on is the FIXTURE — `index` 9, `video_index` 2 and a `url` naming neither, stated
    // in limit 2 of this file's header — not on an assertion that cannot fail.
    expect.soft(el.getAttribute('kind')).toBe('subtitles');
    expect.soft(el.getAttribute('srclang')).toBe('en');
    expect.soft(el.getAttribute('label')).toBe('English');
    // Present, and the empty string is how React spells a boolean attribute. Without it the
    // track loads and shows nothing, which is the failure no event reports.
    expect.soft(el.getAttribute('default')).toBe('');
  });

  it('renders nothing for Off', () => {
    render(<Host chosen={null} />);
    expect(tracks()).toHaveLength(0);
  });

  it('renders nothing for a sidecar whose bytes are not here', () => {
    // A FAILED TRACK LOAD IS NEVER RETRIED, so the element's one load must not be spent on
    // the route's 503. `ready` is measured — complete pieces AND the file present at its
    // declared size — and until the admission's flush runs a fully-held sidecar's bytes live
    // in libtorrent's `.parts` file with nothing at its own path.
    render(<Host chosen={row(9, { ready: false })} />);
    expect(tracks()).toHaveLength(0);
  });

  it('renders nothing for a format this box never converts', () => {
    // `.ass`/`.ssa` are listed so the picker can say the format out loud, and never served:
    // the route answers 415 `unsupported-format` for one, unconditionally and before it opens
    // the file. Waiting does not change it, so there is no state in which this mounts.
    render(<Host chosen={row(9, { format: 'ass', convertible: false, reason: 'unsupported-format' })} />);
    expect(tracks()).toHaveLength(0);
  });

  it('is unmounted while the recovery ladder reloads, and comes back when it is idle', () => {
    // Measured on Chromium 155: each `video.load()` APPENDS a fresh TextTrack per `<track>`
    // child without discarding the previous one — one element, `textTracks` 1 -> 2 -> 3,
    // every copy `showing`, three identical cue lines on the picture. BOTH directions,
    // because asserting only the absence leaves "never mount it at all" green.
    const { rerender } = render(<Host chosen={row(9)} reloading />);
    expect.soft(tracks(), 'while reloading').toHaveLength(0);
    rerender(<Host chosen={row(9)} reloading={false} />);
    expect.soft(tracks(), 'and again once the ladder is idle').toHaveLength(1);
  });

  it('says captions with NO srclang when no language token resolved', () => {
    // HTML requires a non-empty `srclang` for `kind="subtitles"`, and a guessed `en` is a lie
    // the viewer cannot see. `null` is the backend's honest answer (`hi` is refused outright,
    // Hindi against hearing-impaired) and such an entry is still offerable.
    for (const lang of [null, ''] as const) {
      const { unmount } = render(<Host chosen={row(9, { lang, label: 'Unknown language' })} />);
      const el = one();
      expect.soft(el.getAttribute('kind'), JSON.stringify(lang)).toBe('captions');
      // `toBeNull`, not `toBe('')`: an empty attribute is PRESENT, and `srclang=""` with
      // `kind="subtitles"` is the invalid pair this arm exists to prevent.
      expect.soft(el.getAttribute('srclang'), JSON.stringify(lang)).toBeNull();
      expect.soft(el.getAttribute('label'), JSON.stringify(lang)).toBe('Unknown language');
      unmount();
    }
  });

  it('switching entries changes the DOM node, not just its attributes', () => {
    // A track's mode is NOT re-derived when its attributes change, so a reused node keeps
    // showing the previous language's cues with the new `src` hanging off it. The key is what
    // makes a switch a remount; nothing else on the element can express that.
    const { rerender } = render(<Host chosen={row(9)} />);
    const first = one();
    rerender(<Host chosen={row(11, { lang: 'es', label: 'Spanish' })} />);
    const second = one();
    expect.soft(second, 'a new node, not the old one re-dressed').not.toBe(first);
    // And the attributes did follow, so "not the same node" cannot pass by rendering nothing
    // and then something unrelated.
    expect.soft(second.getAttribute('src')).toBe(subtitleTrackSrc(TORRENT, 11));
    expect.soft(second.getAttribute('srclang')).toBe('es');
  });

  it('reports a load failure through the CAPTURE prop, for a non-bubbling event', () => {
    // react-dom 19's `listenToNonDelegatedEvent` block covers `embed`/`source`/`link` and
    // `case "track":` falls through without them, and the native `error` does not bubble — so
    // the bubble prop on a `<track>` is dead code. Measured here: one capture call.
    const unreadable = vi.fn();
    const videoError = vi.fn();
    render(<Host chosen={row(9)} onUnreadable={unreadable} onVideoError={videoError} />);
    const el = one();
    act(() => {
      el.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect.soft(unreadable).toHaveBeenCalledTimes(1);
    // THE REASON THE DISPATCH ABOVE MUST BE NON-BUBBLING, as an assertion rather than a
    // comment: a bubbling error reaches the `<video>`'s own `onError` too, which in the route
    // runs the stream-recovery ladder — four reloads of the film — for a subtitle fault. It
    // would also fire both track props at once, so the `onError`-instead-of-`onErrorCapture`
    // mutation could not be discriminated from it.
    expect.soft(videoError, 'a non-bubbling error never reaches the media element').not.toHaveBeenCalled();
  });

  it('a bubbling error would reach the media element, which is why this one is not', () => {
    const unreadable = vi.fn();
    const videoError = vi.fn();
    render(<Host chosen={row(9)} onUnreadable={unreadable} onVideoError={videoError} />);
    const el = one();
    act(() => {
      el.dispatchEvent(new Event('error', { bubbles: true }));
    });
    // The positive control for the caution in the row above. If this ever stops holding, the
    // `{bubbles: false}` in that row has stopped being load-bearing and the comment there is
    // the thing to delete.
    expect.soft(videoError, 'the hazard is real').toHaveBeenCalled();
  });
});

describe('the element’s source, for the rules no render can show', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/_player/SubtitleTrackElement.tsx'), 'utf8');

  /**
   * Comments stripped, crudely and adequately — this file's own header legitimately names
   * every construct banned below. The compact form of `legacy-target.test.ts`'s scanner;
   * strings are kept, which is the safe direction (a banned name in a string is still
   * caught).
   */
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('strips comments and nothing else', () => {
    // THE POSITIVE CONTROL FOR THE SCANNER ITSELF. Without it, a `code()` that returned the
    // empty string would make every row below pass.
    expect.soft(code('/* addTextTrack */ const a = 1;')).toBe('  const a = 1;');
    expect.soft(code('// crossOrigin\nconst b = 2;')).toBe(' \nconst b = 2;');
    expect.soft(code(SRC), 'the real file still has code in it').toContain('<track');
  });

  it('touches no TextTrack API and no readyState', () => {
    // jsdom has NONE of this — `addTextTrack` reports a jsdomError and returns `undefined`
    // rather than throwing, so even a `toThrow` guard around it would be dead code — and a
    // mode-setting implementation would be a silent no-op in every test AND unexecutable in
    // principle. The only instrument is the source.
    const src = code(SRC);
    expect.soft(src, 'no mode assignment').not.toMatch(/textTracks/);
    expect.soft(src, 'no addTextTrack').not.toMatch(/addTextTrack/);
    expect.soft(src, 'branch on which event fired, never on readiness').not.toMatch(/readyState/);
  });

  it('uses onErrorCapture, never onError or onLoad', () => {
    const src = code(SRC);
    expect.soft(src).toContain('onErrorCapture=');
    expect.soft(src, 'the bubble prop is dead code on a track').not.toMatch(/\bonError=/);
    expect.soft(src, 'load fires for a zero-cue body too, so it says nothing').not.toMatch(/\bonLoad=/);
    // NO `crossOrigin` ROW HERE, deliberately. `noCrossOrigin.test.ts` bans it across the
    // whole surface, which is strictly stronger, and a second copy of one rule is a rule
    // where deleting either copy stays green — the shape this branch keeps finding.
  });

  it('renders one element and never a list of them', () => {
    const src = code(SRC);
    // Two `<track default>` elements both reach `showing` and Blink enforces no winner, so a
    // mapped render is two cue lines rather than one wrong one. The signature already makes
    // it hard — the component is handed ONE entry — and this is the other half.
    expect.soft(src.match(/<track\b/g), 'exactly one element in the whole file').toHaveLength(1);
    expect.soft(src, 'nothing iterated').not.toMatch(/\.map\(/);
  });
});
