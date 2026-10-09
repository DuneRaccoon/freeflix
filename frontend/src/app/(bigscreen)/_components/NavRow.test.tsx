import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FocusProps } from '../_focus/useFocusGrid';
import { NavRow, NAV_TARGETS } from './NavRow';

const props = (): FocusProps => ({ tabIndex: -1, ref: () => {}, onFocus: () => {} });

describe('NavRow', () => {
  it('has the four targets, in order', () => {
    expect(NAV_TARGETS.map((t) => [t.label, t.href])).toEqual([
      ['Search', '/bigscreen/search'],
      ['My List', '/bigscreen/list'],
      ['Switch profile', '/bigscreen/profiles'],
      ['Diagnostics', '/bigscreen/diag'],
    ]);
  });

  it('renders one link per target with its label and href', () => {
    render(<NavRow row={2} focusPropsFor={props} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(NAV_TARGETS.length);
    NAV_TARGETS.forEach((t, i) => {
      expect(links[i]).toHaveTextContent(t.label);
      expect(links[i]).toHaveAttribute('href', t.href);
    });
  });

  it('asks for focus props with the given row and each column', () => {
    const spy = vi.fn(props);
    render(<NavRow row={7} focusPropsFor={spy} />);
    expect(spy.mock.calls).toEqual(NAV_TARGETS.map((_, col) => [7, col]));
  });

  it('applies the focus props to the links, so they are the focus stops', () => {
    const refs: Array<HTMLElement | null> = [];
    render(
      <NavRow
        row={0}
        focusPropsFor={(_, col) => ({ tabIndex: col === 1 ? 0 : -1, ref: (el) => { refs[col] = el; }, onFocus: () => {} })}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
    expect(refs).toEqual(links);
  });

  it('sits in the safe-inset container and uses the self-contained item class', () => {
    const { container } = render(<NavRow row={0} focusPropsFor={props} />);
    const nav = container.querySelector('nav')!;
    expect(nav).toHaveClass('bs-nav');
    expect(nav.querySelectorAll('.bs-nav__item')).toHaveLength(NAV_TARGETS.length);
    // jsdom cannot measure, so pin the rule that carries the inset.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const css = require('node:fs').readFileSync('public/bigscreen.css', 'utf8') as string;
    const rule = /\.bs-nav\s*\{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/padding:[^;]*var\(--safe-x\)/);
    const item = /\.bs-nav__item\s*\{([^}]*)\}/.exec(css)![1];
    expect(Number(/min-height:\s*(\d+)px/.exec(item)![1])).toBeGreaterThanOrEqual(60);
    expect(Number(/font-size:\s*(\d+)px/.exec(item)![1])).toBeGreaterThanOrEqual(24);
  });
});
