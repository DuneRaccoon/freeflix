import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusGrid } from '../_focus/useFocusGrid';
import { BACK_TO_TITLE_CELLS, BackToTitle } from './BackToTitle';

/**
 * The control inside a real grid, which is the only way its focus stop can be observed —
 * `TransportBar.test.tsx`'s harness, cut down to the one row this component occupies. The
 * count is the component's own export, so a declared count that drifted from what it renders
 * would park the ring on nothing here before it did on the television.
 */
function Harness({
  label = 'The Boys',
  visible = true,
  onExit = () => {},
}: {
  label?: string;
  visible?: boolean;
  onExit?: () => void;
}) {
  const grid = useFocusGrid({ rowCounts: [BACK_TO_TITLE_CELLS] });
  return <BackToTitle row={0} focusProps={grid.focusProps} label={label} visible={visible} onExit={onExit} />;
}

describe('BackToTitle', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView, which the grid calls on every move.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is one button named for the title it returns to; the chevron is not part of the name', () => {
    const { container } = render(<Harness />);
    expect.soft(container.querySelectorAll('button'), 'one control').toHaveLength(BACK_TO_TITLE_CELLS);
    // The EXACT name: an announced chevron would rename the control to `‹ The Boys`, and the
    // route's suite finds Back by this name.
    const button = screen.getByRole('button', { name: 'The Boys' });
    expect.soft(button.getAttribute('type')).toBe('button');
    const chevron = [...button.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent);
    expect.soft(chevron, 'the chevron is drawn and hidden').toEqual(['‹']);
    // A real grid cell: the only one, so it holds the ring.
    expect.soft(button.getAttribute('tabindex')).toBe('0');
    // THE TWO SPANS AND NOTHING BETWEEN THEM. They are flex items of the inline-flex `.bs-btn`,
    // where a white-space text run is not drawn, so the gap is the stylesheet's margin on the
    // name (`playerCss.test.tsx` pins it). A text node here would look like the gap in the
    // source and draw nothing on the television.
    expect.soft(
      [...button.childNodes].map((n) => n.nodeName),
      'the chevron, then the name, with no text node between them',
    ).toEqual(['SPAN', 'SPAN']);
  });

  it('reports a press once, and navigates nothing itself', () => {
    // The route flushes the position before it leaves; a control that navigated on its own
    // would be a way out of the player that skipped the write.
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'The Boys' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('hides by paint only: the wrapper takes the modifier, the button keeps its focus stop', () => {
    // The band's own rule, for the same reason: `hidden`, `inert`, `aria-hidden` and
    // unmounting all blur a focused control, and on a surface with no Tab key nothing brings
    // the ring back. The stylesheet makes `--hidden` an opacity and nothing else.
    const { container, rerender } = render(<Harness visible />);
    const wrapper = container.querySelector('.bs-player__back') as HTMLElement;
    expect.soft(wrapper, 'the wrapper is rendered').not.toBeNull();
    expect.soft(wrapper.classList.contains('bs-player__back--hidden'), 'up: no modifier').toBe(false);

    rerender(<Harness visible={false} />);
    const after = container.querySelector('.bs-player__back') as HTMLElement;
    expect.soft(after, 'the SAME wrapper, still in the DOM').toBe(wrapper);
    expect.soft(after.classList.contains('bs-player__back--hidden'), 'down: the modifier').toBe(true);
    const button = screen.getByRole('button', { name: 'The Boys' });
    expect.soft(button.hasAttribute('hidden')).toBe(false);
    expect.soft(button.hasAttribute('inert')).toBe(false);
    expect.soft(button.getAttribute('aria-hidden')).toBeNull();
    expect.soft(after.hasAttribute('hidden')).toBe(false);
    expect.soft(after.hasAttribute('inert')).toBe(false);
    expect.soft(after.getAttribute('aria-hidden')).toBeNull();
    expect.soft(button.getAttribute('tabindex'), 'and it is still the focus stop').toBe('0');
  });
});
