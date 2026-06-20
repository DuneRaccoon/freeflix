import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('renders the FRÈ wordmark as a span by default', () => {
    render(<Wordmark />);
    const el = screen.getByText('FRÈ');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('font-display');
  });
  it('renders as a link when given href', () => {
    render(<Wordmark as="a" href="/" />);
    const link = screen.getByRole('link', { name: 'FRÈ' });
    expect(link).toHaveAttribute('href', '/');
  });
});
