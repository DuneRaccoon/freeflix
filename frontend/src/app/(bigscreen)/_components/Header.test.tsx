import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FocusProps } from '../_focus/useFocusGrid';
import { HEADER_CELLS, HEADER_TARGETS, Header, currentTarget } from './Header';

const css = readFileSync(join(process.cwd(), 'public/bigscreen.css'), 'utf8');
const props = (): FocusProps => ({ tabIndex: -1, ref: () => {}, onFocus: () => {} });
const items = () => screen.getAllByRole('link');

describe('Header', () => {
  it('offers every target, in press order, with Home first', () => {
    // Home is a target like any other because this bar appears on screens that are NOT
    // home, and "how do I get back" is the question a top bar exists to answer.
    expect(HEADER_TARGETS.map((t) => [t.label, t.href])).toEqual([
      ['Home', '/bigscreen'],
      ['Search', '/bigscreen/search'],
      ['My List', '/bigscreen/list'],
      ['Switch profile', '/bigscreen/profiles'],
      ['Diagnostics', '/bigscreen/diag'],
    ]);
  });

  it('renders one link per target, and its count IS what the screen declares', () => {
    // The focus model's contract: a row's declared count equals the cells rendered. One too
    // many parks the ring on a cell no element claims, and a remote has no Tab to escape.
    render(<Header row={0} focusPropsFor={props} />);
    expect(items()).toHaveLength(HEADER_CELLS);
    HEADER_TARGETS.forEach((t, i) => {
      expect(items()[i]).toHaveTextContent(t.label);
      expect(items()[i]).toHaveAttribute('href', t.href);
    });
  });

  it('asks for focus props with the given row and each column', () => {
    const spy = vi.fn(props);
    render(<Header row={3} focusPropsFor={spy} />);
    expect(spy.mock.calls).toEqual(HEADER_TARGETS.map((_, col) => [3, col]));
  });

  it('marks the section the viewer is in, and marks exactly one', () => {
    render(<Header row={0} focusPropsFor={props} pathname="/bigscreen/search" />);
    const marked = items().filter((l) => l.getAttribute('aria-current') === 'page');
    expect(marked.map((l) => l.textContent)).toEqual(['Search']);
  });

  it('matches the path EXACTLY, so Home is not current on every screen', () => {
    // `/bigscreen` is a prefix of every other route here: a `startsWith` would mark Home
    // current on search and My List too, and a bar claiming you are in two places is worse
    // than one claiming nothing.
    expect(currentTarget('/bigscreen')).toBe(0);
    expect(currentTarget('/bigscreen/search')).toBe(1);
    expect(currentTarget('/bigscreen/list')).toBe(2);
    // A detail screen is in no section, and says so.
    expect(currentTarget('/bigscreen/show/1399')).toBe(-1);
    expect(currentTarget('/bigscreen/watch/abc')).toBe(-1);
    expect(currentTarget(null)).toBe(-1);
    expect(currentTarget(undefined)).toBe(-1);
    expect(currentTarget('')).toBe(-1);
  });

  it('absorbs a trailing slash, which is the one spelling difference worth absorbing', () => {
    // `next/link` and a hand-typed URL differ by exactly that.
    expect(currentTarget('/bigscreen/')).toBe(0);
    expect(currentTarget('/bigscreen/search/')).toBe(1);
    // ...and `/` is not `/bigscreen`.
    expect(currentTarget('/')).toBe(-1);
  });

  it('marks nothing when the screen does not say where it is', () => {
    render(<Header row={0} focusPropsFor={props} />);
    expect(items().some((l) => l.hasAttribute('aria-current'))).toBe(false);
  });

  it('keeps the current item a real, focusable link', () => {
    // A menu item that refused to be focused because you are already there is a hole in the
    // row that Left and Right fall into.
    render(<Header row={0} focusPropsFor={() => ({ tabIndex: 0, ref: () => {}, onFocus: () => {} })} pathname="/bigscreen" />);
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('tabindex', '0');
    expect(home).toHaveAttribute('href', '/bigscreen');
  });

  it('applies the focus props to the links, so they are the focus stops', () => {
    const refs: Array<HTMLElement | null> = [];
    const onFocus = vi.fn();
    render(
      <Header
        row={0}
        focusPropsFor={(_, col) => ({
          tabIndex: col === 2 ? 0 : -1,
          ref: (el) => {
            refs[col] = el;
          },
          onFocus,
        })}
      />,
    );
    expect(refs.filter(Boolean)).toHaveLength(HEADER_CELLS);
    expect(items()[2]).toHaveAttribute('tabindex', '0');
    expect(items()[0]).toHaveAttribute('tabindex', '-1');
  });

  it('takes whatever the screen puts beside the menu, and counts none of it', () => {
    // The row's count is HEADER_CELLS; anything in the slot that was a focus stop would be
    // a cell the grid does not know about.
    render(
      <Header row={0} focusPropsFor={props}>
        <p className="bs-shell__exit">Press Back again to close</p>
      </Header>,
    );
    expect(items()).toHaveLength(HEADER_CELLS);
    expect(screen.getByText('Press Back again to close')).toBeInTheDocument();
  });

  it('owns no focus grid and claims no key', () => {
    // A `useFocusGrid` inside this component would be a defect: the listener is on `window`
    // and checks no scope, and effects register CHILD BEFORE PARENT, so a child's grid would
    // silently win and the screen's own grid would be inert.
    const src = readFileSync(join(process.cwd(), 'src/app/(bigscreen)/_components/Header.tsx'), 'utf8');
    expect(src).not.toMatch(/useFocusGrid\s*\(/);
    expect(src).not.toMatch(/addEventListener/);
  });

  it('every bs- class it renders has a rule in the stylesheet', () => {
    // jsdom computes nothing from a linked sheet, so a class typo'd here renders an element
    // that focuses and clicks and has no geometry at all on the television.
    const { container } = render(<Header row={0} focusPropsFor={props} pathname="/bigscreen" />);
    const used = new Set<string>();
    for (const el of container.querySelectorAll('*')) {
      for (const name of el.classList) if (name.startsWith('bs-')) used.add(name);
    }
    // `.bs-shell__head` rides on the same element: the bar is the head's content, so it is
    // base-plus-modifier (the `.bs-card` + `.bs-card--poster` shape) rather than a
    // replacement — the head still carries the safe inset and the baseline row.
    expect([...used].sort()).toEqual([
      'bs-head',
      'bs-head__brand',
      'bs-head__item',
      'bs-head__nav',
      'bs-shell__head',
    ]);
    for (const name of used) {
      expect(css.includes(`.${name}`), `${name} has a rule`).toBe(true);
    }
    // The current-section dress is an ATTRIBUTE selector, not a modifier class, so no later
    // single-class rule can override it.
    expect(css).toMatch(/\.bs-head__item\[aria-current="page"\]/);
  });

  it('does not wrap: one focus row is one visual line', () => {
    // The focus model counts ONE row per container, so a bar that re-flowed would draw one
    // focus row on two visual lines — Right would land on an item on the next line and Down
    // would skip one. The search block's own rule, and the profile grid's.
    const rule = /\.bs-head__nav\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('is a strip, not a title block', () => {
    // `h1` is a global element rule on this surface (56px display face); the brand is a <p>
    // so the bar does not become the biggest thing on every screen.
    const { container } = render(<Header row={0} focusPropsFor={props} />);
    expect(container.querySelector('h1, h2, h3')).toBeNull();
    expect(container.querySelector('.bs-head__brand')?.tagName).toBe('P');
  });
});
