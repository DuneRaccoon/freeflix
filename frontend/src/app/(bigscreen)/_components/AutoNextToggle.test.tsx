/**
 * `_components/AutoNextToggle` — the show screen's switch, as a control.
 *
 * The hook behind it has its own suite (`_data/autoNext.test.tsx`); this file is about the
 * three things the CONTROL owes the focus model and the viewer: it is always there, it is
 * honest about its own state, and it never says a failed read was the viewer's doing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutoNextState } from '../_data/autoNext';
import { AutoNextToggle, autoNextLabel } from './AutoNextToggle';

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');

const fp = () => ({ tabIndex: 0 as const, ref: () => {}, onFocus: () => {} });

const state = (over: Partial<AutoNextState> = {}): AutoNextState => ({
  on: true,
  settled: true,
  readFailed: false,
  writeFailed: false,
  toggle: vi.fn(),
  ...over,
});

const control = () => screen.getByRole('button');

describe('AutoNextToggle', () => {
  it('is one focus stop whatever the state behind it is', () => {
    // The show screen's row 0 declares a CONSTANT count, so this cell must not come and go
    // with the settings read: a cell that appeared when the call answered would be an
    // insertion into the row the ring is most likely sitting in.
    for (const over of [{}, { settled: false }, { readFailed: true, settled: false }, { writeFailed: true }]) {
      const { container, unmount } = render(<AutoNextToggle state={state(over)} focusProps={fp()} />);
      expect.soft(container.querySelectorAll('button'), JSON.stringify(over)).toHaveLength(1);
      unmount();
    }
  });

  it('says which way it is, in the label and in aria-pressed', () => {
    const { rerender } = render(<AutoNextToggle state={state({ on: true })} focusProps={fp()} />);
    expect.soft(control().textContent).toBe(autoNextLabel(true));
    expect.soft(control().getAttribute('aria-pressed')).toBe('true');
    rerender(<AutoNextToggle state={state({ on: false })} focusProps={fp()} />);
    expect.soft(control().textContent).toBe(autoNextLabel(false));
    expect.soft(control().getAttribute('aria-pressed')).toBe('false');
    // The state is the last word in the label, where a viewer's eye lands, and the two
    // labels differ by more than punctuation.
    expect.soft(autoNextLabel(true)).toMatch(/On$/);
    expect.soft(autoNextLabel(false)).toMatch(/Off$/);
  });

  it('is NOT swapped for a different element when it flips', () => {
    // An unmounted focused control drops DOM focus to <body>, and with the row's count
    // unchanged the grid's reconcile effect never re-runs to recover it.
    const { rerender } = render(<AutoNextToggle state={state({ on: true })} focusProps={fp()} />);
    const before = control();
    rerender(<AutoNextToggle state={state({ on: false })} focusProps={fp()} />);
    expect(control()).toBe(before);
  });

  it('presses through to the hook', () => {
    const toggle = vi.fn();
    render(<AutoNextToggle state={state({ toggle })} focusProps={fp()} />);
    fireEvent.click(control());
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('always says what the switch does, because nothing else on the screen does', () => {
    const { container } = render(<AutoNextToggle state={state()} focusProps={fp()} />);
    const notes = [...container.querySelectorAll('.bs-title__note')];
    expect.soft(notes).toHaveLength(1);
    expect.soft(notes[0].textContent).toMatch(/next episode/i);
    // Permanent, not a disclosure that appears on press: a line appearing would nudge the
    // control the ring is sitting on.
    expect.soft(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('a failed READ is a note, and a failed WRITE is an alert', () => {
    // The distinction is the viewer's. Nobody pressed anything for the read, nothing is
    // wrong with what they are doing, and the switch is showing the default — so
    // interrupting a television to announce it would be wrong. A press that could not be
    // saved is the opposite: it is the answer to something they just did.
    const read = render(<AutoNextToggle state={state({ readFailed: true, settled: false })} focusProps={fp()} />);
    expect.soft(read.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect.soft(read.container.querySelectorAll('.bs-title__note')).toHaveLength(2);
    expect.soft(read.container.textContent).toMatch(/default/i);
    read.unmount();

    const write = render(<AutoNextToggle state={state({ writeFailed: true })} focusProps={fp()} />);
    expect.soft(write.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect.soft(screen.getByRole('alert').textContent).toMatch(/save/i);
  });

  it('wears the shared pressed dress, which the stylesheet actually has a rule for', () => {
    // jsdom computes nothing from a linked stylesheet, so a class that exists only in the
    // TSX renders a geometry-less control and every render test here still passes. These are
    // the four the component writes.
    const { container } = render(<AutoNextToggle state={state()} focusProps={fp()} />);
    const used = new Set<string>();
    for (const el of container.querySelectorAll('*')) {
      for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
    }
    expect.soft([...used].sort()).toEqual([
      'bs-btn',
      'bs-btn--ghost',
      'bs-show__autonext',
      'bs-title__action',
      'bs-title__note',
      'bs-title__toggle',
    ]);
    for (const name of used) {
      expect.soft(css.includes(`.${name}`), `${name} has a rule`).toBe(true);
    }
    // The pressed state is read off `aria-pressed`, shared with the movie screen's 4K
    // toggle rather than copied — one rule, two controls.
    expect
      .soft(css, 'the pressed dress is the shared rule')
      .toMatch(/\.bs-title__toggle\[aria-pressed="true"\]/);
    // And the border exists in BOTH states, so turning it on cannot widen the control by 2px
    // and nudge whatever is beside it.
    expect.soft(css).toMatch(/\.bs-title__toggle\s*\{[^}]*border:\s*1px solid var\(--hairline\)/);
  });
});
