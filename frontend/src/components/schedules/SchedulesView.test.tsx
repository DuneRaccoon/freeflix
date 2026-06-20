import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleConfig, ScheduleResponse } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListSchedules = vi.fn();
const mockRunSchedule = vi.fn();
const mockDeleteSchedule = vi.fn();
const mockCreateSchedule = vi.fn();
const mockGetSchedule = vi.fn();
const mockUpdateSchedule = vi.fn();

vi.mock('@/services/schedules', () => ({
  schedulesService: {
    listSchedules:  (...args: unknown[]) => mockListSchedules(...args),
    runSchedule:    (...args: unknown[]) => mockRunSchedule(...args),
    deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
    createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
    getSchedule:    (...args: unknown[]) => mockGetSchedule(...args),
    updateSchedule: (...args: unknown[]) => mockUpdateSchedule(...args),
  },
}));

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'sched-1',
    name: 'Nightly Sci-Fi',
    config: {
      cron_expression: '0 0 * * *',
      search_params: { keyword: '', genre: 'sci-fi', year: '', order_by: 'rating' },
      quality: '1080p',
      max_downloads: 3,
      enabled: true,
    },
    next_run: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'scheduled',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

let SchedulesView: React.ComponentType;
let ScheduleFormFre: React.ComponentType<{
  scheduleId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockListSchedules.mockResolvedValue([]);
  mockRunSchedule.mockResolvedValue({});
  mockDeleteSchedule.mockResolvedValue({});
  mockCreateSchedule.mockResolvedValue({ id: 'new-id' });
  mockGetSchedule.mockResolvedValue(makeSchedule());
  mockUpdateSchedule.mockResolvedValue({ id: 'sched-1' });

  if (!SchedulesView) {
    const mod = await import('./SchedulesView');
    SchedulesView = mod.default;
  }
  if (!ScheduleFormFre) {
    const mod = await import('./ScheduleFormFre');
    ScheduleFormFre = mod.default;
  }
});

// ---------------------------------------------------------------------------
// SchedulesView tests
// ---------------------------------------------------------------------------

describe('SchedulesView', () => {
  it('renders a card per schedule returned by listSchedules', async () => {
    const s1 = makeSchedule({ id: 'sched-1', name: 'Nightly Sci-Fi' });
    const s2 = makeSchedule({ id: 'sched-2', name: 'Weekend Horror' });
    mockListSchedules.mockResolvedValue([s1, s2]);

    render(<SchedulesView />);

    await waitFor(() => {
      expect(screen.getByText('Nightly Sci-Fi')).toBeInTheDocument();
      expect(screen.getByText('Weekend Horror')).toBeInTheDocument();
    });

    const cards = screen.getAllByTestId('schedule-card');
    expect(cards).toHaveLength(2);
  });

  it('shows an empty state when there are no schedules', async () => {
    mockListSchedules.mockResolvedValue([]);

    render(<SchedulesView />);

    await screen.findByTestId('empty-state');
  });

  it('Run-now calls runSchedule with the correct id', async () => {
    mockListSchedules.mockResolvedValue([makeSchedule({ id: 'sched-abc' })]);

    render(<SchedulesView />);

    const runBtn = await screen.findByRole('button', { name: 'Run now' });
    await userEvent.click(runBtn);

    expect(mockRunSchedule).toHaveBeenCalledWith('sched-abc');
  });

  it('Delete (confirmed) calls deleteSchedule', async () => {
    mockListSchedules.mockResolvedValue([makeSchedule({ id: 'sched-del', name: 'To Delete' })]);

    render(<SchedulesView />);

    const deleteBtn = await screen.findByRole('button', { name: 'Delete schedule' });
    await userEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Confirm delete schedule' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm delete' });
    await userEvent.click(confirmBtn);

    expect(mockDeleteSchedule).toHaveBeenCalledWith('sched-del');
  });

  it('opens the form modal when "New schedule" is clicked', async () => {
    mockListSchedules.mockResolvedValue([]);

    render(<SchedulesView />);

    await screen.findByTestId('empty-state');

    await userEvent.click(screen.getByRole('button', { name: 'New schedule' }));

    expect(screen.getByRole('dialog', { name: 'New schedule' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ScheduleFormFre tests
// ---------------------------------------------------------------------------

describe('ScheduleFormFre', () => {
  it('submit (create) builds a valid ScheduleConfig and calls createSchedule', async () => {
    mockCreateSchedule.mockResolvedValue({ id: 'new-sched' });
    const onSuccess = vi.fn();

    render(<ScheduleFormFre onSuccess={onSuccess} />);

    // Submit with defaults
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => {
      expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
    });

    const calledWith: ScheduleConfig = mockCreateSchedule.mock.calls[0][0];
    expect(calledWith).toMatchObject({
      cron_expression: expect.any(String),
      quality: expect.stringMatching(/720p|1080p|2160p/),
      max_downloads: expect.any(Number),
      enabled: expect.any(Boolean),
      search_params: expect.any(Object),
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it('a cron preset selection updates the cron_expression field', async () => {
    render(<ScheduleFormFre />);

    const cronSelect = screen.getByRole('combobox', { name: 'Cron preset' });

    // Change to "Every 6 hours"
    await userEvent.selectOptions(cronSelect, '0 */6 * * *');

    expect((cronSelect as HTMLSelectElement).value).toBe('0 */6 * * *');
  });

  it('loads existing schedule data when scheduleId is provided', async () => {
    const existing = makeSchedule({ name: 'My Existing Schedule' });
    mockGetSchedule.mockResolvedValue(existing);

    render(<ScheduleFormFre scheduleId="sched-1" />);

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('My schedule');
      expect((nameInput as HTMLInputElement).value).toBe('My Existing Schedule');
    });
  });

  it('calls updateSchedule (not createSchedule) when editing', async () => {
    const existing = makeSchedule({ id: 'sched-edit', name: 'Editable' });
    mockGetSchedule.mockResolvedValue(existing);
    mockUpdateSchedule.mockResolvedValue({ id: 'sched-edit' });
    const onSuccess = vi.fn();

    render(<ScheduleFormFre scheduleId="sched-edit" onSuccess={onSuccess} />);

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText('My schedule')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Update schedule' }));

    await waitFor(() => {
      expect(mockUpdateSchedule).toHaveBeenCalledWith('sched-edit', expect.any(Object));
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });
  });
});
