'use client';
import React from 'react';
import { Button, Modal } from '@/components/ui/fre';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Names exactly what is destroyed — this modal is the last stop before the action runs. */
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open, title, body, confirmLabel, destructive = false, busy = false, onConfirm, onClose,
}) => (
  <Modal open={open} onClose={() => { if (!busy) onClose(); }} label={title}>
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl leading-tight text-text">{title}</h2>
        <div className="font-ui text-sm leading-relaxed text-muted">{body}</div>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          type="button"
          variant={destructive ? 'danger' : 'primary'}
          isLoading={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Modal>
);

export default ConfirmModal;
