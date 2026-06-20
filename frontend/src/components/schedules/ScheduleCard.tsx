'use client';
import React, { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ScheduleResponse } from '@/types';
import { Badge, Button, Modal } from '@/components/ui/fre';
import { schedulesService } from '@/services/schedules';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Cron humaniser
// ---------------------------------------------------------------------------
const CRON_MAP: Record<string, string> = {
  '0 0 * * *':     'Daily at midnight',
  '0 12 * * *':    'Daily at noon',
  '0 0 * * 0':     'Weekly on Sunday',
  '0 0 1 * *':     'Monthly (1st day)',
  '0 0 * * 1-5':   'Weekdays at midnight',
  '0 0 * * 6,0':   'Weekends at midnight',
  '0 */6 * * *':   'Every 6 hours',
  '0 */12 * * *':  'Every 12 hours',
};

export function formatCronExpression(cron: string): string {
  if (CRON_MAP[cron]) return CRON_MAP[cron];

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Daily at midnight';
  }
  if (minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:00`;
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
    return `Every Sunday at ${hour}:${minute}`;
  }
  return cron;
}

// ---------------------------------------------------------------------------
// ScheduleCard
// ---------------------------------------------------------------------------

export interface ScheduleCardProps {
  schedule: ScheduleResponse;
  onRefresh: () => void;
  onEdit: (id: string) => void;
}

const ScheduleCard: React.FC<ScheduleCardProps> = ({ schedule, onRefresh, onEdit }) => {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scheduleName = schedule.name ?? `Schedule ${schedule.id.slice(0, 8)}`;
  const params = schedule.config.search_params;

  const searchSummary = params.keyword
    ? `Keyword: "${params.keyword}"`
    : params.year
      ? `Year: ${params.year}`
      : 'Latest';

  const handleRun = async () => {
    setBusy(true);
    try { await schedulesService.runSchedule(schedule.id); }
    finally { setBusy(false); onRefresh(); }
  };

  const handleDelete = async () => {
    setBusy(true);
    setConfirmDelete(false);
    try { await schedulesService.deleteSchedule(schedule.id); }
    finally { setBusy(false); onRefresh(); }
  };

  return (
    <>
      <div
        data-testid="schedule-card"
        className={cn(
          'rounded-xl border border-hairline bg-surface-2/60 p-5',
          'flex flex-col gap-4',
        )}
      >
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-display text-sm font-semibold text-text">
            {scheduleName}
          </span>
          <Badge tone={schedule.config.enabled ? 'success' : 'default'}>
            {schedule.config.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>

        {/* Cron + run times */}
        <div className="space-y-0.5 font-ui text-xs text-muted">
          <p>
            <span className="text-text/60">Schedule: </span>
            {formatCronExpression(schedule.config.cron_expression)}
          </p>
          <p>
            <span className="text-text/60">Next run: </span>
            {format(new Date(schedule.next_run), 'PPp')}
            {' '}
            <span className="text-muted/60">
              ({formatDistanceToNow(new Date(schedule.next_run), { addSuffix: true })})
            </span>
          </p>
          {schedule.last_run && (
            <p>
              <span className="text-text/60">Last run: </span>
              {format(new Date(schedule.last_run), 'PPp')}
            </p>
          )}
        </div>

        {/* Search param summary */}
        <div className="rounded-lg border border-hairline bg-surface/60 p-3 font-ui text-xs space-y-1">
          <p className="text-text/80">{searchSummary}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
            {params.genre && params.genre !== 'all' && (
              <span>Genre: <span className="text-text/70">{params.genre}</span></span>
            )}
            <span>Quality: <span className="text-text/70">{schedule.config.quality}</span></span>
            <span>Max: <span className="text-text/70">{schedule.config.max_downloads}</span></span>
            {params.order_by && (
              <span>Sort: <span className="text-text/70">{params.order_by}</span></span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={handleRun}
            aria-label="Run now"
          >
            Run now
          </Button>
          <Button
            size="sm"
            variant="glass"
            disabled={busy}
            onClick={() => onEdit(schedule.id)}
            aria-label="Edit schedule"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete schedule"
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        label="Confirm delete schedule"
      >
        <p className="font-ui text-sm text-text mb-5">
          Delete <strong className="text-gold-lite">{scheduleName}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <Button size="sm" variant="glass" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={handleDelete}
            aria-label="Confirm delete"
          >
            Delete
          </Button>
        </div>
      </Modal>
    </>
  );
};

export default ScheduleCard;
