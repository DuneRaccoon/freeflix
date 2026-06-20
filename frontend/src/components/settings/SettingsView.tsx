'use client';
import React, { useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { usersService, UserSettings } from '@/services/users';
import { baseService } from '@/services/api-client';
import { Badge, Button, Field, Input, Select, Toggle } from '@/components/ui/fre';
import UserAvatar from '@/components/users/UserAvatar';
import AvatarSelector from '@/components/users/AvatarSelector';
import { cn } from '@/lib/cn';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemInfo {
  status: string;
  service: string;
  platform: string;
  hardware: string;
}

interface HealthInfo {
  status: string;
  active_torrents: number;
  scheduler_enabled: boolean;
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-muted mb-4">
    {children}
  </h2>
);

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div
    className={cn(
      'rounded-2xl border border-hairline bg-surface-2/60 p-6 space-y-5',
      className,
    )}
  >
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// System card (health + info)
// ---------------------------------------------------------------------------

const SystemCard: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sys, health] = await Promise.all([
        baseService.root() as Promise<SystemInfo>,
        baseService.healthcheck() as Promise<HealthInfo>,
      ]);
      if (!mountedRef.current) return;
      setSystemInfo(sys);
      setHealthInfo(health);
    } catch {
      if (!mountedRef.current) return;
      setError('Could not reach the API — check that the backend is running.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const rows: { label: string; value: React.ReactNode }[] = systemInfo && healthInfo
    ? [
        { label: 'Service', value: systemInfo.service },
        { label: 'Platform', value: `${systemInfo.platform} (${systemInfo.hardware})` },
        {
          label: 'API status',
          value: (
            <Badge tone={healthInfo.status === 'healthy' ? 'success' : 'gold'}>
              {healthInfo.status === 'healthy' ? 'Connected' : healthInfo.status}
            </Badge>
          ),
        },
        { label: 'Active torrents', value: healthInfo.active_torrents },
        {
          label: 'Scheduler',
          value: (
            <Badge tone={healthInfo.scheduler_enabled ? 'success' : 'default'}>
              {healthInfo.scheduler_enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          ),
        },
      ]
    : [];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeading>System</SectionHeading>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          isLoading={loading}
          aria-label="Refresh system info"
        >
          Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="font-ui text-sm text-danger">
          {error}
        </p>
      )}

      {loading && !error && (
        <div
          data-testid="system-loading"
          className="space-y-3 animate-pulse"
          aria-label="Loading system info"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex justify-between">
              <div className="h-4 w-24 rounded bg-surface-2" />
              <div className="h-4 w-32 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && (
        <dl data-testid="system-info" className="space-y-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-1.5 border-b border-hairline last:border-0">
              <dt className="font-ui text-sm text-muted">{label}</dt>
              <dd className="font-ui text-sm text-text font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

const ProfileSection: React.FC<{
  userId: string;
  canEdit: boolean;
}> = ({ userId, canEdit }) => {
  const { currentUser, users, updateUser } = useUser();
  const user = users.find((u) => u.id === userId) ?? currentUser;

  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(
    user?.avatar ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // keep in sync if context reloads
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setSelectedAvatar(user.avatar ?? null);
    }
  }, [user?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setNameError('Display name is required');
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await updateUser(userId, {
        display_name: displayName.trim(),
        avatar: selectedAvatar ?? undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <Card>
      <SectionHeading>Profile</SectionHeading>
      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <UserAvatar user={user} size="lg" />
          <div className="flex-1 space-y-1">
            <Field label="Display name" error={nameError ?? undefined} htmlFor="display-name">
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                disabled={!canEdit}
              />
            </Field>
            <p className="font-ui text-xs text-muted">Username: {user.username}</p>
          </div>
        </div>

        {canEdit && (
          <AvatarSelector
            selectedAvatar={selectedAvatar}
            onChange={setSelectedAvatar}
          />
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" isLoading={saving}>
              Save profile
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Preferences section
// ---------------------------------------------------------------------------

const QUALITY_OPTIONS = [
  { value: '720p', label: '720p HD' },
  { value: '1080p', label: '1080p Full HD' },
  { value: '2160p', label: '2160p (4K UHD)' },
];

const PreferencesSection: React.FC<{
  userId: string;
  settings: UserSettings | null;
  canEdit: boolean;
}> = ({ userId, settings, canEdit }) => {
  const { updateUserSettings } = useUser();

  const [defaultQuality, setDefaultQuality] = useState<UserSettings['default_quality']>(
    settings?.default_quality ?? '1080p',
  );
  const [downloadPath, setDownloadPath] = useState(settings?.download_path ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDefaultQuality(settings.default_quality);
      setDownloadPath(settings.download_path ?? '');
    }
  }, [settings?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // NOTE: we intentionally do NOT write the `theme` field — app is dark-only
      await updateUserSettings(userId, {
        default_quality: defaultQuality,
        download_path: downloadPath.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionHeading>Preferences</SectionHeading>
      <form onSubmit={handleSave} className="space-y-5">
        <Field label="Default quality" htmlFor="default-quality">
          <Select
            id="default-quality"
            data-testid="quality-select"
            options={QUALITY_OPTIONS}
            value={defaultQuality}
            onChange={(e) =>
              setDefaultQuality(e.target.value as UserSettings['default_quality'])
            }
            disabled={!canEdit}
          />
        </Field>

        <Field
          label="Download path"
          hint="Leave blank to use the system default."
          htmlFor="download-path"
        >
          <Input
            id="download-path"
            value={downloadPath}
            onChange={(e) => setDownloadPath(e.target.value)}
            placeholder="/opt/freeflix/downloads"
            disabled={!canEdit}
          />
        </Field>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" isLoading={saving}>
              Save preferences
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Restrictions section
// ---------------------------------------------------------------------------

const MATURITY_OPTIONS = [
  { value: 'none', label: 'No restrictions' },
  { value: 'pg', label: 'PG and below' },
  { value: 'pg13', label: 'PG-13 and below' },
  { value: 'r', label: 'R and below' },
];

const RestrictionsSection: React.FC<{
  userId: string;
  settings: UserSettings | null;
  canEdit: boolean;
}> = ({ userId, settings, canEdit }) => {
  const { updateUserSettings } = useUser();

  const [maturity, setMaturity] = useState<UserSettings['maturity_restriction']>(
    settings?.maturity_restriction ?? 'none',
  );
  const [requirePasscode, setRequirePasscode] = useState(
    settings?.require_passcode ?? false,
  );
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setMaturity(settings.maturity_restriction);
      setRequirePasscode(settings.require_passcode);
    }
  }, [settings?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requirePasscode && passcode && passcode !== confirmPasscode) {
      setError('Passcodes do not match');
      return;
    }
    if (requirePasscode && !settings?.passcode && !passcode.trim()) {
      setError('A passcode is required when restriction is enabled');
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<UserSettings> = {
        maturity_restriction: maturity,
        require_passcode: requirePasscode,
      };
      if (requirePasscode && passcode.trim()) {
        patch.passcode = passcode.trim();
      }
      await updateUserSettings(userId, patch);
      setPasscode('');
      setConfirmPasscode('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionHeading>Restrictions</SectionHeading>
      <form onSubmit={handleSave} className="space-y-5">
        {error && (
          <p role="alert" className="font-ui text-sm text-danger">
            {error}
          </p>
        )}

        <Field label="Maturity level" htmlFor="maturity-select">
          <Select
            id="maturity-select"
            options={MATURITY_OPTIONS}
            value={maturity}
            onChange={(e) =>
              setMaturity(e.target.value as UserSettings['maturity_restriction'])
            }
            disabled={!canEdit}
          />
        </Field>

        <Toggle
          checked={requirePasscode}
          onChange={setRequirePasscode}
          label="Require passcode for restricted content"
          disabled={!canEdit}
        />

        {requirePasscode && (
          <div
            data-testid="passcode-fields"
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <Field label="Passcode" htmlFor="passcode">
              <Input
                id="passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="••••"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Confirm passcode" htmlFor="confirm-passcode">
              <Input
                id="confirm-passcode"
                type="password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder="••••"
                disabled={!canEdit}
              />
            </Field>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" isLoading={saving}>
              Save restrictions
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// SettingsView (main export)
// ---------------------------------------------------------------------------

export interface SettingsViewProps {
  /** If provided, load per-profile settings for this userId; otherwise system-only */
  userId?: string;
}

const SettingsView: React.FC<SettingsViewProps> = ({ userId }) => {
  const { currentUser, userSettings, isLoading } = useUser();

  // Determine the effective userId we're editing
  const effectiveId = userId ?? currentUser?.id;
  const canEdit = !!effectiveId && effectiveId === currentUser?.id;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div
          className="h-10 w-10 rounded-full border-2 border-t-transparent border-gold animate-spin"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-16 space-y-8">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>

      {effectiveId && (
        <>
          <ProfileSection userId={effectiveId} canEdit={canEdit} />
          <PreferencesSection
            userId={effectiveId}
            settings={canEdit ? userSettings : null}
            canEdit={canEdit}
          />
          <RestrictionsSection
            userId={effectiveId}
            settings={canEdit ? userSettings : null}
            canEdit={canEdit}
          />
        </>
      )}

      <SystemCard />
    </div>
  );
};

export default SettingsView;
