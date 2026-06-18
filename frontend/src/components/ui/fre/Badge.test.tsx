import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('defaults to the default tone', () => {
    render(<Badge>4K</Badge>);
    expect(screen.getByText('4K').dataset.tone).toBe('default');
  });
  it('honors the tone prop', () => {
    render(<Badge tone="gold">Featured</Badge>);
    expect(screen.getByText('Featured').dataset.tone).toBe('gold');
  });
});
