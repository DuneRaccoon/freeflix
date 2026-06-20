'use client';
import React, { createContext, useContext } from 'react';

type Theme = 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  isThemeLoading: boolean;
}

const noop = async (): Promise<void> => {};

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: noop,
  toggleTheme: noop,
  isThemeLoading: false,
});

/** Dark-only. FRÈ is an inherently dark identity; the toggle/persistence were
 *  retired. The `useTheme()` API is kept so existing consumers still compile. */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider value={{ theme: 'dark', setTheme: noop, toggleTheme: noop, isThemeLoading: false }}>
    {children}
  </ThemeContext.Provider>
);

export const useTheme = (): ThemeContextType => useContext(ThemeContext);
