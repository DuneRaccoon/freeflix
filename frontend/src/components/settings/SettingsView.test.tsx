import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateUserSettings = vi.fn();
const mockUpdateUser = vi.fn();

const mockUser = {
  id: 'user-1',
  username: 'testuser',
  display_name: 'Test User',
  avatar: null,
  created_at: '2024-01-01T00:00:00Z',
};

const mockUserSettings = {
  id: 'settings-1',
  user_id: 'user-1',
  maturity_restriction: 'none' as const,
  require_passcode: false,
  theme: 'dark' as const,
  default_quality: '1080p' as const,
  download_path: '/downloads',
};

vi.mock('@/context/UserContext', () => ({
  useUser: () => ({
    currentUser: mockUser,
    userSettings: mockUserSettings,
    users: [mockUser],
    isLoading: false,
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    updateUserSettings: (...args: unknown[]) => mockUpdateUserSettings(...args),
  }),
}));

const mockRoot = vi.fn();
const mockHealthcheck = vi.fn();

vi.mock('@/services/api-client', () => ({
  baseService: {
    root: (...args: unknown[]) => mockRoot(...args),
    healthcheck: (...args: unknown[]) => mockHealthcheck(...args),
  },
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

// AvatarSelector is a pure presentational list of images — stub it to keep
// tests free of image-loading concerns
vi.mock('@/components/users/AvatarSelector', () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('/avatars/test.png')}>
      Pick avatar
    </button>
  ),
}));

// UserAvatar — just render a stub
vi.mock('@/components/users/UserAvatar', () => ({
  default: ({ user }: { user: { display_name: string } }) => (
    <img src="/placeholder.png" alt={user.display_name} />
  ),
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

let SettingsView: React.ComponentType<{ userId?: string }>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockUpdateUserSettings.mockResolvedValue(mockUserSettings);
  mockUpdateUser.mockResolvedValue(mockUser);
  mockRoot.mockResolvedValue({
    status: 'ok',
    service: 'Freeflix API',
    platform: 'linux',
    hardware: 'arm64',
  });
  mockHealthcheck.mockResolvedValue({
    status: 'healthy',
    active_torrents: 1,
    scheduler_enabled: true,
  });
  if (!SettingsView) {
    const mod = await import('./SettingsView');
    SettingsView = mod.default;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsView', () => {
  it('renders the three sections (Profile, Preferences, Restrictions)', async () => {
    render(<SettingsView userId="user-1" />);

    // Section headings — wait for the async system card to settle
    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Preferences')).toBeInTheDocument();
      expect(screen.getByText('Restrictions')).toBeInTheDocument();
    });
  });

  it('does NOT render a theme <select>', async () => {
    render(<SettingsView userId="user-1" />);

    // All combboxes on the page
    await waitFor(() => {
      // Wait for the quality select to appear (preferences loaded)
      expect(screen.getByTestId('quality-select')).toBeInTheDocument();
    });

    // None of the selects should have a "Dark Theme" or "Light Theme" option
    const allOptions = screen.queryAllByRole('option');
    const themeOptions = allOptions.filter(
      (o) => o.textContent === 'Dark Theme' || o.textContent === 'Light Theme',
    );
    expect(themeOptions).toHaveLength(0);
  });

  it('changing default quality calls updateUserSettings with default_quality', async () => {
    render(<SettingsView userId="user-1" />);

    const qualitySelect = await screen.findByTestId('quality-select');

    // Change from 1080p to 2160p
    await userEvent.selectOptions(qualitySelect, '2160p');

    const saveBtn = screen.getByRole('button', { name: 'Save preferences' });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateUserSettings).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ default_quality: '2160p' }),
      );
    });
  });

  it('toggling require-passcode reveals the passcode inputs', async () => {
    render(<SettingsView userId="user-1" />);

    // Wait for system card to settle first
    await waitFor(() => expect(screen.getByTestId('system-info')).toBeInTheDocument());

    // Passcode fields should not be visible initially (require_passcode=false)
    expect(screen.queryByTestId('passcode-fields')).toBeNull();

    // Toggle it on
    const toggle = screen.getByRole('switch');
    await userEvent.click(toggle);

    // Now the passcode section should be visible
    expect(await screen.findByTestId('passcode-fields')).toBeInTheDocument();
  });

  it('the system card shows health info from baseService', async () => {
    render(<SettingsView userId="user-1" />);

    // Health info loads async
    await waitFor(() => {
      expect(screen.getByTestId('system-info')).toBeInTheDocument();
    });

    expect(screen.getByText('Freeflix API')).toBeInTheDocument();
    expect(screen.getByText('linux (arm64)')).toBeInTheDocument();
  });

  it('renders system card even when no userId provided', async () => {
    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId('system-info')).toBeInTheDocument();
    });
  });
});
