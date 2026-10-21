/**
 * `_data/autoNext.ts` — the per-profile "get the next episode ready" switch.
 *
 * THE ROW THAT MATTERS IS THE DEFAULT. The column behind this is nullable with no default
 * (there is no migration framework, so `sync_columns()` can only ADD a bare column), the
 * server turns NULL into `true`, and the client type is OPTIONAL because a required field
 * would be a type error in every settings-shaped literal under `src/components/`. So
 * `undefined` reaches `autoNextFrom`, and `!settings?.auto_next_episode` — the obvious
 * spelling — reads it as OFF. That ships the feature off for every household that already
 * has a database.
 *
 * THE OTHER ROW THAT MATTERS IS `settled`. The prefetch gates on it and the toggle does not,
 * because the costs differ: a control has to render something, and a download on a Raspberry
 * Pi should not happen on a guess.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { usersService, type UserSettings } from '@/services/users';
import { autoNextFrom, useAutoNext } from './autoNext';

vi.mock('@/services/users', () => ({
  usersService: { getUserSettings: vi.fn(), updateUserSettings: vi.fn() },
}));

const users = vi.mocked(usersService);

const settings = (over: Partial<UserSettings> = {}): UserSettings =>
  ({
    id: 's1',
    user_id: 'p1',
    maturity_restriction: 'none',
    require_passcode: false,
    has_passcode: false,
    passcode_len: null,
    theme: 'dark',
    default_quality: '1080p',
    ...over,
  }) as UserSettings;

/** The hook's state, rendered as text so the assertions read like the screen. */
function Harness({ userId }: { userId: string | null }) {
  const state = useAutoNext(userId);
  return (
    <>
      <p data-testid="state">
        {`${state.on ? 'on' : 'off'} ${state.settled ? 'settled' : 'waiting'}`}
        {state.readFailed ? ' readFailed' : ''}
        {state.writeFailed ? ' writeFailed' : ''}
      </p>
      <button type="button" onClick={state.toggle}>
        toggle
      </button>
    </>
  );
}

const state = () => screen.getByTestId('state').textContent;
const press = async () => {
  await act(async () => {
    screen.getByRole('button', { name: 'toggle' }).click();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoNextFrom', () => {
  it('is ON unless something says `false`', () => {
    // `undefined` is the migrated column, a settings row nobody could read, and an older
    // backend that does not know the field — none of which is a viewer's decision.
    expect(autoNextFrom(undefined)).toBe(true);
    expect(autoNextFrom(null)).toBe(true);
    expect(autoNextFrom(settings())).toBe(true);
    expect(autoNextFrom(settings({ auto_next_episode: true }))).toBe(true);
  });

  it('is OFF only for an explicit `false`', () => {
    expect(autoNextFrom(settings({ auto_next_episode: false }))).toBe(false);
  });
});

describe('useAutoNext', () => {
  it('starts un-settled and defaults to on, then takes the profile’s answer', async () => {
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: false }));
    render(<Harness userId="p1" />);
    // Before the read answers: something for the toggle to draw, and nothing for the
    // prefetch to act on.
    expect(state()).toBe('on waiting');
    await waitFor(() => expect(state()).toBe('off settled'));
    expect(users.getUserSettings).toHaveBeenCalledWith('p1');
  });

  it('does not settle for no profile, and asks the box nothing', async () => {
    render(<Harness userId={null} />);
    await act(async () => {});
    // NOT settled: a download keyed to no history is not something to start on a default.
    expect(state()).toBe('on waiting');
    expect(users.getUserSettings).not.toHaveBeenCalled();
  });

  it('does not settle when the read FAILS, and says so', async () => {
    users.getUserSettings.mockRejectedValue(new Error('offline'));
    render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on waiting readFailed'));
  });

  it('flips at once on a press, and keeps the box’s answer', async () => {
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    users.updateUserSettings.mockResolvedValue(settings({ auto_next_episode: false }));
    render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on settled'));
    await press();
    expect(state()).toBe('off settled');
    expect(users.updateUserSettings).toHaveBeenCalledWith('p1', { auto_next_episode: false });
  });

  it('takes the BOX’s answer, not the press’s', async () => {
    // Another device wrote it, or an older backend ignored the field: what the next episode
    // is actually decided by is what came back.
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    users.updateUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on settled'));
    await press();
    await waitFor(() => expect(state()).toBe('on settled'));
  });

  it('puts the switch back when the write is refused, and says so', async () => {
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    users.updateUserSettings.mockRejectedValue(new Error('nope'));
    render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on settled'));
    await press();
    // There is no toaster on this surface, so a control that lied about its own state would
    // be the only thing the viewer had to go on.
    await waitFor(() => expect(state()).toBe('on settled writeFailed'));
  });

  it('ignores a second press while the first is still in flight', async () => {
    // Two PUTs racing each other is a switch whose final state the box decides, and the
    // control has already answered the first press.
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    let settle: (v: UserSettings) => void = () => {};
    users.updateUserSettings.mockReturnValue(
      new Promise<UserSettings>((resolve) => {
        settle = resolve;
      }),
    );
    render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on settled'));
    await press();
    await press();
    expect(users.updateUserSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(settings({ auto_next_episode: false }));
    });
    expect(state()).toBe('off settled');
    // And the next press goes through, so the guard is a latch and not a one-shot.
    users.updateUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    await press();
    expect(users.updateUserSettings).toHaveBeenCalledTimes(2);
  });

  it('clears a failure when the profile changes, and re-reads', async () => {
    users.getUserSettings.mockRejectedValueOnce(new Error('offline'));
    const { rerender } = render(<Harness userId="p1" />);
    await waitFor(() => expect(state()).toBe('on waiting readFailed'));
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: false }));
    rerender(<Harness userId="p2" />);
    await waitFor(() => expect(state()).toBe('off settled'));
    expect(users.getUserSettings).toHaveBeenLastCalledWith('p2');
  });

  it('does not let a read for the previous profile answer for the new one', async () => {
    let settleFirst: (v: UserSettings) => void = () => {};
    users.getUserSettings.mockReturnValueOnce(
      new Promise<UserSettings>((resolve) => {
        settleFirst = resolve;
      }),
    );
    const { rerender } = render(<Harness userId="p1" />);
    users.getUserSettings.mockResolvedValue(settings({ auto_next_episode: true }));
    rerender(<Harness userId="p2" />);
    await waitFor(() => expect(state()).toBe('on settled'));
    await act(async () => {
      settleFirst(settings({ auto_next_episode: false }));
    });
    // p1's answer must not turn p2's switch off.
    expect(state()).toBe('on settled');
  });
});
