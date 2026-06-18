'use client';
import React, { useEffect, useState } from 'react';
import { ScheduleConfig } from '@/types';
import { Button, Field, Input, Select, Toggle } from '@/components/ui/fre';
import { schedulesService } from '@/services/schedules';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRON_PRESETS = [
  { value: '0 0 * * *',    label: 'Daily at midnight' },
  { value: '0 12 * * *',   label: 'Daily at noon' },
  { value: '0 0 * * 0',    label: 'Weekly on Sunday' },
  { value: '0 0 1 * *',    label: 'Monthly (1st day)' },
  { value: '0 0 * * 1-5',  label: 'Weekdays at midnight' },
  { value: '0 0 * * 6,0',  label: 'Weekends at midnight' },
  { value: '0 */6 * * *',  label: 'Every 6 hours' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
];

const QUALITY_OPTIONS = [
  { value: '720p',  label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2160p', label: '4K (2160p)' },
];

const GENRE_OPTIONS = [
  { value: 'all',         label: 'All Genres' },
  { value: 'action',      label: 'Action' },
  { value: 'adventure',   label: 'Adventure' },
  { value: 'animation',   label: 'Animation' },
  { value: 'comedy',      label: 'Comedy' },
  { value: 'crime',       label: 'Crime' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'drama',       label: 'Drama' },
  { value: 'family',      label: 'Family' },
  { value: 'fantasy',     label: 'Fantasy' },
  { value: 'history',     label: 'History' },
  { value: 'horror',      label: 'Horror' },
  { value: 'mystery',     label: 'Mystery' },
  { value: 'romance',     label: 'Romance' },
  { value: 'sci-fi',      label: 'Sci-Fi' },
  { value: 'thriller',    label: 'Thriller' },
  { value: 'war',         label: 'War' },
  { value: 'western',     label: 'Western' },
];

const ORDER_BY_OPTIONS = [
  { value: 'rating',   label: 'Rating' },
  { value: 'featured', label: 'Featured' },
  { value: 'date',     label: 'Date Added' },
  { value: 'title',    label: 'Title' },
  { value: 'year',     label: 'Year' },
];

const DEFAULT_CONFIG: ScheduleConfig = {
  name: '',
  cron_expression: '0 0 * * *',
  search_params: {
    keyword: '',
    genre: 'all',
    year: '',
    order_by: 'rating',
  },
  quality: '1080p',
  max_downloads: 1,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ScheduleFormFreProps {
  /** When provided, load and edit the existing schedule */
  scheduleId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ScheduleFormFre: React.FC<ScheduleFormFreProps> = ({
  scheduleId,
  onSuccess,
  onCancel,
}) => {
  const isEditing = Boolean(scheduleId);

  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing schedule when editing
  useEffect(() => {
    if (!scheduleId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await schedulesService.getSchedule(scheduleId);
        if (!cancelled) {
          setConfig({
            name: s.name ?? '',
            cron_expression: s.config.cron_expression,
            search_params: {
              keyword: s.config.search_params.keyword ?? '',
              genre: s.config.search_params.genre ?? 'all',
              year: s.config.search_params.year ?? '',
              order_by: s.config.search_params.order_by ?? 'rating',
            },
            quality: s.config.quality,
            max_downloads: s.config.max_downloads,
            enabled: s.config.enabled,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load schedule.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [scheduleId]);

  // ---------------------------------------------------------------------------
  // Field helpers
  // ---------------------------------------------------------------------------
  const set = <K extends keyof ScheduleConfig>(key: K, value: ScheduleConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const setParam = (key: string, value: string) =>
    setConfig((prev) => ({
      ...prev,
      search_params: { ...prev.search_params, [key]: value },
    }));

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEditing && scheduleId) {
        await schedulesService.updateSchedule(scheduleId, config);
      } else {
        await schedulesService.createSchedule(config);
      }
      onSuccess?.();
    } catch {
      setError(`Failed to ${isEditing ? 'update' : 'create'} schedule.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-surface-2/60 border border-hairline" />
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Basic */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold text-text/80 uppercase tracking-wide">
          Basic
        </h3>

        <Field label="Name (optional)">
          <Input
            placeholder="My schedule"
            value={config.name ?? ''}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Schedule pattern">
            <Select
              options={CRON_PRESETS}
              value={config.cron_expression}
              onChange={(e) => set('cron_expression', e.target.value)}
              aria-label="Cron preset"
            />
          </Field>

          <Field label="Enabled" className="justify-end pb-1">
            <Toggle
              checked={config.enabled}
              onChange={(v) => set('enabled', v)}
              label={config.enabled ? 'Enabled' : 'Disabled'}
            />
          </Field>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Search criteria */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold text-text/80 uppercase tracking-wide">
          Search criteria
        </h3>

        <Field label="Keyword (optional)" hint="Leave blank to use genre / year filters">
          <Input
            placeholder="e.g. Oppenheimer"
            value={config.search_params.keyword ?? ''}
            onChange={(e) => setParam('keyword', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Genre">
            <Select
              options={GENRE_OPTIONS}
              value={(config.search_params.genre as string) ?? 'all'}
              onChange={(e) => setParam('genre', e.target.value)}
            />
          </Field>

          <Field label="Year" hint="4-digit year, or blank for any">
            <Input
              type="number"
              placeholder="e.g. 2024"
              min={1900}
              max={2099}
              value={(config.search_params.year as string) ?? ''}
              onChange={(e) => setParam('year', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Sort by">
          <Select
            options={ORDER_BY_OPTIONS}
            value={(config.search_params.order_by as string) ?? 'rating'}
            onChange={(e) => setParam('order_by', e.target.value)}
          />
        </Field>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Download options */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h3 className="font-display text-sm font-semibold text-text/80 uppercase tracking-wide">
          Download options
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Quality">
            <Select
              options={QUALITY_OPTIONS}
              value={config.quality}
              onChange={(e) =>
                set('quality', e.target.value as '720p' | '1080p' | '2160p')
              }
            />
          </Field>

          <Field label="Max downloads" hint="1–10 per run">
            <Input
              type="number"
              min={1}
              max={10}
              value={config.max_downloads}
              onChange={(e) => set('max_downloads', Number(e.target.value))}
            />
          </Field>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Error + actions */}
      {/* ---------------------------------------------------------------- */}
      {error && (
        <p role="alert" className="font-ui text-xs text-danger">{error}</p>
      )}

      <div className="flex gap-3 justify-end pt-2">
        {onCancel && (
          <Button type="button" variant="glass" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" isLoading={submitting}>
          {isEditing ? 'Update schedule' : 'Create schedule'}
        </Button>
      </div>
    </form>
  );
};

export default ScheduleFormFre;
