import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('FRÈ token utilities', () => {
  it('a consumer can apply token utility classes', () => {
    render(<div data-testid="swatch" className="bg-ink text-gold font-display rounded-card" />);
    const el = screen.getByTestId('swatch');
    expect(el.className).toContain('bg-ink');
    expect(el.className).toContain('text-gold');
    expect(el.className).toContain('font-display');
    expect(el.className).toContain('rounded-card');
  });
});
