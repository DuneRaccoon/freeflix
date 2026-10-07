import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BigscreenPlaceholderPage from './page';

describe('/bigscreen placeholder', () => {
  it('confirms the television is signed in', () => {
    render(<BigscreenPlaceholderPage />);
    expect(screen.getByRole('heading', { name: /signed in/i })).toBeInTheDocument();
    expect(screen.getByText(/paired/i)).toBeInTheDocument();
  });

  it('links to the diagnostics page', () => {
    render(<BigscreenPlaceholderPage />);
    expect(screen.getByRole('link', { name: /diagnostics/i })).toHaveAttribute('href', '/bigscreen/diag');
  });
});
