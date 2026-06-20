'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { ScheduleResponse } from '@/types';
import { schedulesService } from '@/services/schedules';
import { Button, Modal } from '@/components/ui/fre';
import ScheduleCard from './ScheduleCard';
import ScheduleFormFre from './ScheduleFormFre';

// ---------------------------------------------------------------------------
// SchedulesView
// ---------------------------------------------------------------------------

const SchedulesView: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // Form modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  const fetchSchedules = useCallback(async () => {
    try {
      const data = await schedulesService.listSchedules();
      setSchedules(data);
    } catch {
      // silently ignore transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const openCreate = () => {
    setEditingId(undefined);
    setFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(undefined);
  };

  const afterMutation = () => {
    closeForm();
    fetchSchedules();
  };

  return (
    <div className="pt-[72px]">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-text">Schedules</h1>
            <p className="mt-0.5 font-ui text-sm text-muted">
              Automated download rules ({schedules.length})
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={openCreate}
            aria-label="New schedule"
          >
            + New schedule
          </Button>
        </div>

        {/* List or empty state */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-hairline bg-surface-2/40 h-36 animate-pulse"
              />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div
            data-testid="empty-state"
            className="rounded-xl border border-hairline bg-surface-2/40 p-12 text-center space-y-3"
          >
            <p className="font-display text-base text-muted">
              No schedules yet.
            </p>
            <Button size="sm" variant="glass" onClick={openCreate}>
              Create your first schedule
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onRefresh={fetchSchedules}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        label={editingId ? 'Edit schedule' : 'New schedule'}
        className="max-w-lg"
      >
        <h2 className="font-display text-lg font-semibold text-text mb-5">
          {editingId ? 'Edit schedule' : 'New schedule'}
        </h2>
        <ScheduleFormFre
          scheduleId={editingId}
          onSuccess={afterMutation}
          onCancel={closeForm}
        />
      </Modal>
    </div>
  );
};

export default SchedulesView;
