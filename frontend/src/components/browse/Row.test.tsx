/**
 * Row — Vitest + RTL tests
 *
 * Spec (Task 3):
 *  - renders the section title
 *  - renders a "See all" link when seeAllHref is provided
 *  - does NOT render "See all" when seeAllHref is absent
 *  - renders both the prev and next arrow buttons
 *  - renders children inside the scroll track
 *  - clicking the prev arrow calls scrollBy on the track
 *  - clicking the next arrow calls scrollBy on the track
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Row from './Row';

describe('Row', () => {
  it('renders the section title', () => {
    render(<Row title="Trending Now">child</Row>);
    expect(screen.getByRole('heading', { name: 'Trending Now' })).toBeInTheDocument();
  });

  it('renders the eyebrow when provided', () => {
    render(
      <Row title="Top Films" eyebrow="Editor's Pick">
        child
      </Row>,
    );
    expect(screen.getByText("Editor's Pick")).toBeInTheDocument();
  });

  it('does not render an eyebrow when not provided', () => {
    render(<Row title="Top Films">child</Row>);
    // No eyebrow text at all
    expect(screen.queryByText("Editor's Pick")).not.toBeInTheDocument();
  });

  it('renders a "See all" link when seeAllHref is provided', () => {
    render(
      <Row title="New Releases" seeAllHref="/movies">
        child
      </Row>,
    );
    const link = screen.getByRole('link', { name: /See all/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/movies');
  });

  it('does NOT render a "See all" link when seeAllHref is absent', () => {
    render(<Row title="New Releases">child</Row>);
    expect(screen.queryByRole('link', { name: /See all/i })).not.toBeInTheDocument();
  });

  it('renders both the prev and next arrow buttons', () => {
    render(<Row title="Movies">child</Row>);
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
  });

  it('renders children inside the scroll track', () => {
    render(
      <Row title="Films">
        <div>Card One</div>
        <div>Card Two</div>
      </Row>,
    );
    expect(screen.getByText('Card One')).toBeInTheDocument();
    expect(screen.getByText('Card Two')).toBeInTheDocument();
  });

  it('clicking the prev arrow invokes scrollBy on the track', () => {
    render(<Row title="Films">child</Row>);

    const track = screen.getByRole('list', { name: 'Films items' });

    // Mock scrollBy on the specific element
    const scrollBySpy = vi.fn();
    Object.defineProperty(track, 'scrollBy', {
      value: scrollBySpy,
      writable: true,
    });

    const prevBtn = screen.getByRole('button', { name: 'Scroll left' });
    fireEvent.click(prevBtn);

    expect(scrollBySpy).toHaveBeenCalledOnce();
    const [callArg] = scrollBySpy.mock.calls[0];
    expect(callArg).toMatchObject({ behavior: 'smooth' });
    expect(callArg.left).toBeLessThan(0);
  });

  it('clicking the next arrow invokes scrollBy on the track', () => {
    render(<Row title="Films">child</Row>);

    const track = screen.getByRole('list', { name: 'Films items' });

    const scrollBySpy = vi.fn();
    Object.defineProperty(track, 'scrollBy', {
      value: scrollBySpy,
      writable: true,
    });

    const nextBtn = screen.getByRole('button', { name: 'Scroll right' });
    fireEvent.click(nextBtn);

    expect(scrollBySpy).toHaveBeenCalledOnce();
    const [callArg] = scrollBySpy.mock.calls[0];
    expect(callArg).toMatchObject({ behavior: 'smooth' });
    expect(callArg.left).toBeGreaterThan(0);
  });

  it('the track has role=list and tabIndex=0 for keyboard accessibility', () => {
    render(<Row title="Keyboard Test">child</Row>);
    const track = screen.getByRole('list', { name: 'Keyboard Test items' });
    expect(track).toHaveAttribute('tabindex', '0');
  });
});
