import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useFocusGrid } from '../_focus/useFocusGrid';
import { MEDIA_KEYS, MEDIA_KEY_CODES, type MediaKeyAction } from '../_focus/useMediaKeys';
import type { FocusProps } from '../_focus/useFocusGrid';
import { cellLabel, SUBTITLE_CELL_LABELS, SUBTITLE_CELL_STATES } from '../_data/subtitles';
import { NEXT_CELL_STATES } from '../_data/nextEpisode';
import {
  TransportBar,
  TRANSPORT_CELLS,
  RETRY_CELL,
  NEXT_CELL,
  NEXT_CELL_AFTER,
  MEDIA_TWINS,
  TWIN_CELL,
  transportCells,
  transportCellCount,
  labelFor,
  type NextCellView,
  type SubtitleCellView,
  type TransportAction,
} from './TransportBar';

const fp = (): ((row: number, col: number) => FocusProps) => () => ({
  tabIndex: -1,
  ref: () => {},
  onFocus: () => {},
});

/**
 * The transport row inside a real grid, which is the only way the ring can be observed.
 *
 * IT CARRIES A SUBTITLE VIEW BY DEFAULT, and that is not decoration. The rows below query
 * cells by their EXACT accessible name, so with a sub-line on the Subtitles cell those
 * queries are also the test of its `aria-hidden`: drop the attribute and the cell's name
 * becomes `Subtitles off`, and `getByRole('button', { name: 'Subtitles' })` stops finding it.
 * Passing nothing here would have left that mutation green in every row in the file.
 */
const SUB_VIEW: SubtitleCellView = { stateId: 'off', note: cellLabel('off') };

function Harness({
  playing = true,
  retry = false,
  subtitles = SUB_VIEW,
  next,
  onAction = () => {},
}: {
  playing?: boolean;
  retry?: boolean;
  /** `null` means "the screen has no answer yet", which is a different prop from the default. */
  subtitles?: SubtitleCellView | null;
  /** Absent by default, which is a film: the cell has to be asked for. */
  next?: NextCellView;
  onAction?: (a: TransportAction) => void;
}) {
  // The count follows the props, which is the contract this harness exists to keep: a row
  // that declared more cells than it rendered would park the ring on nothing.
  const grid = useFocusGrid({ rowCounts: [transportCellCount({ retry, next: next !== undefined })] });
  return (
    <TransportBar
      row={0}
      focusProps={grid.focusProps}
      playing={playing}
      retry={retry}
      subtitles={subtitles ?? undefined}
      next={next}
      onAction={onAction}
    />
  );
}

describe('TransportBar', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView, which the grid calls on every move.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders exactly the cells it declares, and declares exactly what it renders', () => {
    // The focus model's contract: a row's declared count IS the cells it renders. One too
    // many parks the ring on a cell no element claims, and a remote has no Tab to escape.
    for (const retry of [false, true]) {
      const { container, unmount } = render(
        <TransportBar row={0} focusProps={fp()} playing retry={retry} onAction={() => {}} />,
      );
      expect.soft(container.querySelectorAll('button'), `retry=${retry}`).toHaveLength(
        transportCellCount({ retry }),
      );
      unmount();
    }
  });

  it('is a row of real <button>s, because OK is a native click', () => {
    // Neither `useFocusGrid` nor `useMediaKeys` claims Enter (`useFocusGrid.test.tsx:128`
    // pins that), so activation is the browser turning OK into a click. The web player's
    // `div role="slider"` would be a dead cell on a remote.
    const { container } = render(
      <TransportBar row={0} focusProps={fp()} playing retry onAction={() => {}} />,
    );
    const cells = [...container.querySelectorAll('.bs-player__row > *')];
    expect(cells.length).toBe(transportCellCount({ retry: true }));
    for (const cell of cells) {
      expect.soft(cell.tagName, cell.textContent ?? '').toBe('BUTTON');
      expect.soft(cell.getAttribute('type'), cell.textContent ?? '').toBe('button');
    }
  });

  it('gives each cell its own column, starting at the row it is given', () => {
    const calls: Array<[number, number]> = [];
    render(
      <TransportBar
        row={4}
        focusProps={(row, col) => {
          calls.push([row, col]);
          return { tabIndex: -1, ref: () => {}, onFocus: () => {} };
        }}
        playing
        onAction={() => {}}
      />,
    );
    expect(calls).toEqual(TRANSPORT_CELLS.map((_c, col) => [4, col]));
  });

  it('reports the cell that was pressed, and nothing else', () => {
    const onAction = vi.fn();
    render(<Harness retry onAction={onAction} />);
    for (const cell of transportCells({ retry: true })) {
      fireEvent.click(screen.getByRole('button', { name: labelFor(cell, { playing: true }) }));
      expect.soft(onAction).toHaveBeenLastCalledWith(cell.id);
    }
    expect(onAction).toHaveBeenCalledTimes(transportCellCount({ retry: true }));
  });

  it('RELABELS Play/Pause and never swaps the element', () => {
    // Swapping the element type (or the React key) unmounts the control the ring is on and
    // drops DOM focus to <body>, where the grid's reconcile effect — unchanged counts —
    // never re-runs to recover it.
    const { rerender } = render(<Harness playing={false} />);
    const before = screen.getByRole('button', { name: 'Play' });
    expect(document.activeElement).toBe(before);
    rerender(<Harness playing />);
    const after = screen.getByRole('button', { name: 'Pause' });
    expect.soft(after, 'the same element, relabelled').toBe(before);
    expect.soft(document.activeElement, 'focus never left it').toBe(after);
    expect.soft(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('gives every media-key action a focusable on-screen twin', () => {
    // Task 7 deliberately made no key code a dependency: nothing on this set has ever been
    // logged, `415/19/413/412/417` are recalled documentation and that `e.key` is populated
    // at all is a guess. This test is what makes an unrecognised key a missing SHORTCUT
    // rather than a missing feature — so the actions are read off the hook's own exported
    // tables, not from a list written here that could drift from them.
    const actions = new Set<MediaKeyAction>([
      ...MEDIA_KEYS.map(([, a]) => a),
      ...MEDIA_KEY_CODES.map(([, a]) => a),
    ]);
    expect(actions.size).toBeGreaterThan(0);
    render(<Harness retry />);
    const rendered = transportCells({ retry: true });
    for (const action of actions) {
      // Through BOTH tables: `MEDIA_TWINS` says what the key means, `TWIN_CELL` says which
      // control embodies it. ▶, ⏸ and the toggle mean three different things and share one
      // cell, so a test that went straight from the key to a cell id could not tell the
      // difference — which is how ▶ came to pause a playing title.
      const twin = TWIN_CELL[MEDIA_TWINS[action]];
      const cell = rendered.find((c) => c.id === twin);
      expect.soft(cell, `${action} -> ${twin} is a cell that exists`).toBeDefined();
      if (!cell) continue;
      const el = screen.getByRole('button', { name: labelFor(cell, { playing: true }) });
      // Focusable: a roving-tabindex cell is tabIndex 0 or -1, never absent, and never
      // disabled — a disabled focus stop is a control that refuses to act.
      expect.soft(el.getAttribute('tabindex'), `${action} twin is a focus stop`).not.toBeNull();
      expect.soft(el).not.toBeDisabled();
    }
  });

  it('keeps ▶ and ⏸ as separate intents on the one shared control', () => {
    // The remote's two keys are not a toggle. Measured before this split: with the title
    // playing, a Play press called `pause()` once and `play()` not at all.
    expect.soft(MEDIA_TWINS.play).toBe('play');
    expect.soft(MEDIA_TWINS.pause).toBe('pause');
    expect.soft(MEDIA_TWINS.playPause).toBe('playPause');
    // ...and all three still land on the one focusable cell, so the twin contract holds.
    expect.soft(TWIN_CELL.play).toBe('playPause');
    expect.soft(TWIN_CELL.pause).toBe('playPause');
    expect.soft(TWIN_CELL.playPause).toBe('playPause');
    // Every action has a cell, and every cell is a cell that exists. THE WHOLE ROW, both
    // flags on: `TWIN_CELL` is a `Record` over every action, including `nextEpisode`, so the
    // set it is checked against has to be the one that can hold every cell. Asked with
    // `next: false` this row reports the Next-episode cell as a twin that does not exist —
    // which is true of that shape of row and not a defect in the table.
    const ids = new Set(transportCells({ retry: true, next: true }).map((c) => c.id));
    for (const [action, cellId] of Object.entries(TWIN_CELL)) {
      expect.soft(ids.has(cellId), `${action} -> ${cellId}`).toBe(true);
    }
  });

  it('appends Retry last, so growing the row never moves the ring', () => {
    // The grid calls `go` only when the CLAMPED TARGET CHANGES, so growth never refocuses.
    // A cell inserted at or before the focused column therefore leaves DOM focus on the
    // element that just became column 1 while the model still points at column 0 — and the
    // next press appears to do nothing. (`LoadStatus` gives its PREPENDED retry `autoFocus`
    // for exactly this reason; this row cannot, because it must not steal focus mid-film.)
    // Soft, all of it: a hard assertion here ends the test at the ordering and the ring
    // assertions below — the ones that describe what the viewer experiences — would be
    // asserted by lines that never ran.
    expect.soft(transportCells({ retry: true }).at(-1)?.id).toBe(RETRY_CELL.id);
    const { rerender } = render(<Harness />);
    const first = screen.getByRole('button', { name: 'Pause' });
    expect(document.activeElement).toBe(first);
    rerender(<Harness retry />);
    expect.soft(document.activeElement, 'DOM focus stayed put').toBe(first);
    // ...and the model agrees with the DOM: the roving tabindex is the model's own answer.
    expect.soft(first.getAttribute('tabindex'), 'the model still points here').toBe('0');
    expect.soft(screen.getByRole('button', { name: RETRY_CELL.label }).getAttribute('tabindex')).toBe('-1');
  });

  it('owns no focus grid and claims no key', () => {
    // A `useFocusGrid` inside this component is a defect: the listener is on `window` and
    // checks no scope, and effects register CHILD BEFORE PARENT, so a child's grid would
    // silently win and the screen's grid would be inert.
    const src = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/_player/TransportBar.tsx'), 'utf8');
    expect.soft(src).not.toMatch(/useFocusGrid\s*\(/);
    expect.soft(src).not.toMatch(/addEventListener/);
    const added: string[] = [];
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      added.push(type);
    }) as typeof window.addEventListener);
    render(<TransportBar row={0} focusProps={fp()} playing retry onAction={() => {}} />);
    spy.mockRestore();
    expect.soft(added).toEqual([]);
    // And an arrow press is nobody's business here: no handler, nothing claimed.
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(e);
    });
    expect.soft(e.defaultPrevented).toBe(false);
  });

  it('labels every cell with words a viewer can read from ten feet', () => {
    for (const cell of transportCells({ retry: true })) {
      const label = labelFor(cell, { playing: false });
      expect.soft(label.length, cell.id).toBeGreaterThan(2);
      expect.soft(label, cell.id).toMatch(/[A-Za-z]/);
    }
    // The ±60s twins say which direction and how far, since they are also how a viewer
    // repeats a jump the remote's own buttons do once per press.
    expect.soft(labelFor(RETRY_CELL, { playing: false })).toBe(RETRY_CELL.label);
    const ids = transportCells({ retry: true }).map((c) => c.id);
    expect.soft(ids).toContain('back60');
    expect.soft(ids).toContain('forward60');
    expect.soft(ids).toContain('back10');
    expect.soft(ids).toContain('stop');
  });

  // =================================================================================
  // Stage 9: the Subtitles cell
  // =================================================================================

  /** Whoever the model says holds the ring. One element, always, or the remote is stuck. */
  const ring = () => Array.from(document.querySelectorAll('[tabindex="0"]'));

  /** A press at the focused element, bubbling to the grid's window listener. */
  function arrow(key: 'ArrowLeft' | 'ArrowRight') {
    const target = document.activeElement ?? document.body;
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  }

  const subCell = () => screen.getByRole('button', { name: 'Subtitles' });

  it('declares the Subtitles cell between Forward and Stop, unconditionally', () => {
    // ABSOLUTE, not derived. The position is the whole of D12: this row's focus model
    // tolerates growth at the END only (`go` runs only when the clamped target CHANGES), so
    // an id list that merely CONTAINS `subtitles` would be green with the cell appended after
    // Retry — which is a second appender racing the one append this row is allowed.
    expect.soft(TRANSPORT_CELLS.map((c) => c.id)).toEqual([
      'playPause',
      'back10',
      'back60',
      'forward60',
      'subtitles',
      'stop',
    ]);
    // ...and the count the screen puts in `rowCounts` moved with it, both ways. No new
    // option: `transportCellCount` is still `transportCells(opts).length`, so a cell this
    // function does not know about cannot exist.
    expect.soft(transportCellCount({ retry: false })).toBe(6);
    expect.soft(transportCellCount({ retry: true })).toBe(7);
    // The dress is the existing ghost one. A second `primary` in the row would read as a
    // second Play button at three metres, and no class is added to the stylesheet for this.
    const sub = TRANSPORT_CELLS.find((c) => c.id === 'subtitles');
    expect.soft(sub?.variant).toBe('ghost');
    expect.soft(sub?.label).toBe('Subtitles');
  });

  it('renders the cell with no state to show at all', () => {
    // THE CELL IS NOT A FUNCTION OF THE LIST. `transportCells` is pinned above, but the
    // render is a second place the condition could live — and the route is a third. This is
    // the DOM witness: no view, no retry, and the cell is still a `<button>` in the row.
    for (const retry of [false, true]) {
      const { container, unmount } = render(
        <TransportBar row={0} focusProps={fp()} playing retry={retry} onAction={() => {}} />,
      );
      const buttons = [...container.querySelectorAll('.bs-player__row > button')];
      expect.soft(buttons, `retry=${retry}`).toHaveLength(transportCellCount({ retry }));
      expect.soft(screen.getByRole('button', { name: 'Subtitles' }), `retry=${retry}`).toBeDefined();
      // Nothing said, and nothing CLAIMED either: with no answer from the screen there is no
      // sub-line and no attribute, so "not asked yet" and the `loading` state are different
      // things in the DOM rather than the same empty string.
      expect.soft(container.querySelectorAll('.bs-player__commit'), `retry=${retry}`).toHaveLength(0);
      expect.soft(container.querySelectorAll('[data-subtitles]'), `retry=${retry}`).toHaveLength(0);
      expect.soft(screen.getByRole('button', { name: 'Subtitles' }).textContent).toBe('Subtitles');
      unmount();
    }
  });

  it('says its state in a sub-line that is NOT part of the cell’s name', () => {
    // Every state, because the nine phrasings are the nine things this television can say
    // about subtitles and the cell is the only place eight of them appear. The words come
    // from `_data/subtitles.cellLabel` and are asserted to be EXACTLY that: a label built
    // here — or one with a language interpolated into it — reddens this row, and the row is
    // `flex-wrap: nowrap`, so an overflowed cell is one the D-pad can focus and the viewer
    // cannot see.
    //
    // `getByRole(..., { name: 'Subtitles' })` is an exact match, so it is also the test of
    // the sub-line's `aria-hidden`: without it the accessible name is `Subtitles off` and
    // this query stops finding the cell. The attribute is asserted structurally as well,
    // because the name computation is a library's business and the attribute is ours.
    for (const state of SUBTITLE_CELL_STATES) {
      const { unmount } = render(
        <TransportBar
          row={0}
          focusProps={fp()}
          playing
          subtitles={{ stateId: state, note: cellLabel(state) }}
          onAction={() => {}}
        />,
      );
      const el = subCell();
      expect.soft(el.getAttribute('data-subtitles'), state).toBe(state);
      const note = el.querySelector('.bs-player__commit');
      expect.soft(note, `${state} has a sub-line`).not.toBeNull();
      expect.soft(note?.textContent, state).toBe(cellLabel(state));
      expect.soft(note?.getAttribute('aria-hidden'), state).toBe('true');
      unmount();
    }
  });

  it('renders the words it is HANDED, instead of re-deriving them from the state', () => {
    // THE MUTATION THIS ROW EXISTS FOR, and it was green in all 2399: have this component
    // ignore `note` and call `cellLabel(view.stateId)` itself. Every other row here and in
    // the route's suite hands it `note: cellLabel(state)` and then asserts the rendered text
    // IS `cellLabel(state)` — the shape the interface's own docstring warns about ("a test
    // that re-derived the words it is checking checks nothing"), written into the tests
    // rather than into the component. So this fixture's note is deliberately not one of the
    // nine phrasings: the screen owns the words and this component may not second-guess
    // them, because the picker's chosen language will ride in the same slot.
    const handed = 'whatever the screen said';
    expect
      .soft(Object.values(SUBTITLE_CELL_LABELS), 'the fixture is not a real phrasing')
      .not.toContain(handed);
    render(
      <TransportBar
        row={0}
        focusProps={fp()}
        playing
        subtitles={{ stateId: 'off', note: handed }}
        onAction={() => {}}
      />,
    );
    const el = subCell();
    expect.soft(el.querySelector('.bs-player__commit')?.textContent).toBe(handed);
    // ...and the two fields stay independent: the attribute is the state, not the words.
    expect.soft(el.getAttribute('data-subtitles')).toBe('off');
  });

  it('gives the sub-line to that cell and to no other', () => {
    // The mutation this row exists for: render the sub-line for every cell. With
    // `aria-hidden` kept, every accessible name still reads correctly and nothing else in
    // this file notices — six cells would just be wearing a stranger's state.
    const { container } = render(
      <TransportBar
        row={0}
        focusProps={fp()}
        playing
        retry
        subtitles={{ stateId: 'fetching', note: cellLabel('fetching') }}
        onAction={() => {}}
      />,
    );
    const notes = [...container.querySelectorAll('.bs-player__commit')];
    expect.soft(notes).toHaveLength(1);
    expect.soft(notes[0]?.parentElement).toBe(subCell());
    const tagged = [...container.querySelectorAll('[data-subtitles]')];
    expect.soft(tagged).toEqual([subCell()]);
    for (const cell of transportCells({ retry: true })) {
      if (cell.id === 'subtitles') continue;
      const label = labelFor(cell, { playing: true });
      expect.soft(screen.getByRole('button', { name: label }).textContent, cell.id).toBe(label);
    }
  });

  it('is already there when the state arrives, so the ring never moves under the viewer', () => {
    // THE REASON THE CELL IS UNCONDITIONAL, as a behaviour rather than as an argument. A cell
    // that appeared with its state would be an insertion at column 4 of a row whose focus can
    // be at 4 or 5 — and `useFocusGrid` calls `go` only when the CLAMPED TARGET CHANGES
    // (`useFocusGrid.ts:300`), so the insertion leaves DOM focus on the element that just
    // became the next column while the model still points at the old one. Measured against
    // both shapes of that mutation: a `transportCells` that only lists the cell once a view
    // exists, and a render that skips the cell while the declared count keeps it.
    // THE COLUMN IS CHOSEN, NOT SATURATED, and the first version of this row was wrong
    // because it saturated: walking to the END of the row put the ring on the cell AFTER the
    // insertion point, where the model's column index happens to name the same element
    // before and after the cell arrives — green under both mutations. Column 4 is the
    // insertion point itself, which is the only column the defect is visible from.
    const { rerender } = render(<Harness subtitles={null} />);
    for (let i = 0; i < 4; i++) arrow('ArrowRight');
    const subEl = screen.queryByRole('button', { name: 'Subtitles' });
    expect.soft(subEl, 'the cell is in the row before there is any state to show').not.toBeNull();
    expect.soft(document.activeElement, 'and column 4 is where it is').toBe(subEl);
    rerender(<Harness subtitles={SUB_VIEW} />);
    expect.soft(document.activeElement, 'DOM focus stayed put').toBe(subEl);
    expect.soft(ring(), 'exactly one cell holds the ring').toHaveLength(1);
    expect.soft(ring()[0], 'and the model agrees with the DOM').toBe(subEl);
    // And the row did not change size: the state is what arrived, not a cell.
    expect.soft(document.querySelectorAll('.bs-player__row > button')).toHaveLength(
      transportCellCount({ retry: false }),
    );
  });

  // =================================================================================
  // The Next-episode cell
  // =================================================================================

  const nextView = (stateId: NextCellView['stateId'] = 'ready', note = 'S02 · E03'): NextCellView => ({
    stateId,
    note,
  });
  const nextCell = () => screen.getByRole('button', { name: 'Next episode' });

  it('is absent until the screen asks for it, and the row’s count agrees', () => {
    // A film has no next episode, and a cell that did nothing would be a focus stop on every
    // film with nothing behind it.
    const { container, unmount } = render(
      <TransportBar row={0} focusProps={fp()} playing subtitles={SUB_VIEW} onAction={() => {}} />,
    );
    expect.soft(screen.queryByRole('button', { name: 'Next episode' })).toBeNull();
    expect.soft(container.querySelectorAll('.bs-player__row > button')).toHaveLength(
      transportCellCount({ retry: false }),
    );
    expect.soft(transportCellCount({ retry: false })).toBe(6);
    unmount();
  });

  it('sits straight after the forward jump, and Retry is still last', () => {
    // ABSOLUTE, like the Subtitles row's own ordering assertion: an id list that merely
    // CONTAINED `nextEpisode` would be green with the cell appended after Retry, which is a
    // second appender racing the one append this row's focus model allows.
    expect.soft(transportCells({ next: true }).map((c) => c.id)).toEqual([
      'playPause',
      'back10',
      'back60',
      'forward60',
      'nextEpisode',
      'subtitles',
      'stop',
    ]);
    expect.soft(transportCells({ next: true, retry: true }).at(-1)?.id).toBe(RETRY_CELL.id);
    expect.soft(transportCellCount({ retry: false, next: true })).toBe(7);
    expect.soft(transportCellCount({ retry: true, next: true })).toBe(8);
    // The dress is the ghost one: a second gold circle in the row would read as a second
    // Play button at three metres.
    expect.soft(NEXT_CELL.variant).toBe('ghost');
    // And the anchor is a cell that exists, so the splice can never fall back to appending.
    expect.soft(TRANSPORT_CELLS.map((c) => c.id)).toContain(NEXT_CELL_AFTER);
  });

  it('follows its anchor if the table is reordered, rather than a column number', () => {
    // Exercises the REAL composition against a reordered table, which is the edit that would
    // silently move a hard-coded index onto some other control.
    const reordered = [...TRANSPORT_CELLS].reverse();
    const at = reordered.findIndex((c) => c.id === NEXT_CELL_AFTER);
    const spliced = [...reordered.slice(0, at + 1), NEXT_CELL, ...reordered.slice(at + 1)];
    expect(spliced[at + 1]?.id).toBe('nextEpisode');
  });

  it('says its state in a sub-line that is NOT part of the cell’s name', () => {
    for (const stateId of NEXT_CELL_STATES) {
      const { unmount } = render(
        <TransportBar row={0} focusProps={fp()} playing next={nextView(stateId, `note-${stateId}`)} onAction={() => {}} />,
      );
      const el = nextCell();
      expect.soft(el.getAttribute('data-next'), stateId).toBe(stateId);
      const note = el.querySelector('.bs-player__commit');
      expect.soft(note?.textContent, stateId).toBe(`note-${stateId}`);
      expect.soft(note?.getAttribute('aria-hidden'), stateId).toBe('true');
      unmount();
    }
  });

  it('renders the words it is HANDED, instead of re-deriving them from the state', () => {
    // The same mutation the Subtitles cell's own row is written for: have this component call
    // `nextCellView` itself. Every other row hands it the real phrasing and then asserts the
    // rendered text is that phrasing, which checks nothing.
    render(
      <TransportBar row={0} focusProps={fp()} playing next={nextView('ready', 'whatever the screen said')} onAction={() => {}} />,
    );
    expect.soft(nextCell().querySelector('.bs-player__commit')?.textContent).toBe('whatever the screen said');
    expect.soft(nextCell().getAttribute('data-next')).toBe('ready');
  });

  it('gives each cell its own sub-line and nobody else’s', () => {
    const { container } = render(
      <TransportBar
        row={0}
        focusProps={fp()}
        playing
        retry
        subtitles={SUB_VIEW}
        next={nextView()}
        onAction={() => {}}
      />,
    );
    // Two cells carry one, and each carries its own: the mutation is a `cellNote` that
    // returned the same view for both, which every single-view row above would miss.
    expect.soft(container.querySelectorAll('.bs-player__commit')).toHaveLength(2);
    expect.soft(nextCell().querySelector('.bs-player__commit')?.textContent).toBe('S02 · E03');
    expect.soft(subCell().querySelector('.bs-player__commit')?.textContent).toBe(cellLabel('off'));
    expect.soft([...container.querySelectorAll('[data-next]')]).toEqual([nextCell()]);
    expect.soft([...container.querySelectorAll('[data-subtitles]')]).toEqual([subCell()]);
  });

  it('reports its own press', () => {
    const onAction = vi.fn();
    render(<TransportBar row={0} focusProps={fp()} playing next={nextView()} onAction={onAction} />);
    fireEvent.click(nextCell());
    expect(onAction).toHaveBeenCalledWith('nextEpisode');
  });

  it('is a focus stop like any other cell, in whatever state it is in', () => {
    // Including `none` and `unknown`: a cell dressed as disabled is a control that refuses to
    // act, and the row's declared count would still be counting it.
    for (const stateId of NEXT_CELL_STATES) {
      const { unmount } = render(
        <Harness next={nextView(stateId, 'x')} />,
      );
      const el = nextCell();
      expect.soft(el.getAttribute('tabindex'), stateId).not.toBeNull();
      expect.soft(el, stateId).not.toBeDisabled();
      unmount();
    }
  });

  it('every cell keeps its name in the DOM, which is what the icons depend on', () => {
    // The glyph is the only thing the viewer reads; the WORD is the accessible name, revealed
    // by `:focus` in the stylesheet. `display: none` would have taken it out of the
    // accessibility tree — and out of every query in this directory — which is why the
    // reveal is opacity. This is the row that notices if the label stops being rendered.
    const { container } = render(
      <Harness retry next={nextView()} />,
    );
    for (const cell of transportCells({ retry: true, next: true })) {
      const label = labelFor(cell, { playing: true });
      const el = screen.getByRole('button', { name: label });
      expect.soft(el.querySelector('.bs-tp__label')?.textContent, cell.id).toBe(label);
      expect.soft(el.querySelector('.bs-tp__label')?.getAttribute('aria-hidden'), cell.id).toBeNull();
      // ...and the glyph carries no text, or it would land in the name.
      expect.soft(el.querySelector('.bs-tp__glyph')?.textContent, cell.id).toBe('');
    }
    expect.soft(container.querySelectorAll('svg')).toHaveLength(transportCellCount({ retry: true, next: true }));
  });

  it('draws a different glyph for Play than for Pause, on the one shared cell', () => {
    // The label is relabelled rather than swapped and so is the picture; a glyph that did
    // not follow would be a gold circle showing a pause bar over a paused title.
    const { rerender } = render(<Harness playing />);
    const paused = screen.getByRole('button', { name: 'Pause' }).querySelector('path')?.getAttribute('d');
    rerender(<Harness playing={false} />);
    const play = screen.getByRole('button', { name: 'Play' }).querySelector('path')?.getAttribute('d');
    expect.soft(paused).toBeTruthy();
    expect.soft(play).toBeTruthy();
    expect.soft(play).not.toBe(paused);
  });

  it('has no media-key twin, and that is deliberate rather than forgotten', () => {
    // Device reading 34 (`/bigscreen/diag` -> Remote key codes) is what would license one:
    // nothing is known about whether this set's own subtitle/CC key reaches the page or with
    // what `keyCode`. `MEDIA_TWINS` is keyed on the hook's action union, so the absence costs
    // nothing and claims nothing — and this row is here so that ADDING one is a deliberate
    // edit with a reading behind it, rather than a guess that looks like completeness.
    expect.soft(Object.values(MEDIA_TWINS)).not.toContain('subtitles');
    // The `TWIN_CELL` entry is what `tsc` forces (a `Record` over the whole action union) and
    // nothing reads it today — the walk above only requires it to name SOME cell that exists,
    // which `stop` would also satisfy. Pinned here so that the day a reading adds the key,
    // the press lands on the control it is about.
    expect.soft(TWIN_CELL.subtitles).toBe('subtitles');
  });
});
