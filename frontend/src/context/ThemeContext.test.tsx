import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function Probe() {
  const { theme, isThemeLoading } = useTheme();
  return <span data-testid="t">{theme}:{String(isThemeLoading)}</span>;
}

describe('ThemeContext (dark-only)', () => {
  it('always reports dark and not loading', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('t')).toHaveTextContent('dark:false');
  });
  it('setTheme/toggleTheme are callable no-ops that keep dark', async () => {
    let captured = '';
    function Mutate() {
      const { theme, setTheme, toggleTheme } = useTheme();
      captured = theme;
      // calling them must not throw and must not change the reported theme
      void setTheme('dark');
      void toggleTheme();
      return <span data-testid="m">{theme}</span>;
    }
    render(<ThemeProvider><Mutate /></ThemeProvider>);
    expect(screen.getByTestId('m')).toHaveTextContent('dark');
    expect(captured).toBe('dark');
  });
});
