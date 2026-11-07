'use client';
import React, { useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { useSession } from '@/context/SessionContext';
import { instanceService, OwnerSettings } from '@/services/instance';
import { usersService, UserSettings } from '@/services/users';
import { baseService } from '@/services/api-client';
import { avatarsService, LibraryStill } from '@/services/avatars';
import { Badge, Button, Field, Input, Select, Toggle } from '@/components/ui/fre';
import Avatar from '@/components/users/Avatar';
import AvatarPicker from '@/components/users/AvatarPicker';
import { getInitials } from '@/lib/avatars/resolve';
import { cn } from '@/lib/cn';
import { toast } from 'react-hot-toast';
import { useInstall } from '@/lib/pwa/install';
import ProfileLockSection from './ProfileLockSection';

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
// App card (install as an app)
// ---------------------------------------------------------------------------

const INSTALL_COPY: Record<string, string> = {
  installed: 'FRÈ is installed on this device.',
  promptable: 'Install FRÈ to open it from your home screen, dock or start menu, in its own window.',
  ios: 'In Safari, tap the Share button, then “Add to Home Screen”.',
  insecure: 'Installing needs a secure connection. Open FRÈ over https (or on localhost) to install it.',
  manual: 'Use your browser’s menu to install — “Install FRÈ” in Chrome or Edge, or “Add to Dock” in Safari.',
};

export const InstallCard: React.FC = () => {
  const { state, install } = useInstall();
  if (state === null) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeading>App</SectionHeading>
        {state === 'installed' && <Badge tone="success">Installed</Badge>}
      </div>
      <p data-testid="install-copy" className="font-ui text-sm text-muted">
        {INSTALL_COPY[state]}
      </p>
      {state === 'promptable' && (
        <Button variant="primary" size="sm" onClick={() => { void install(); }}>
          Install app
        </Button>
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
  const [libraryStills, setLibraryStills] = useState<LibraryStill[]>([]);

  // keep in sync if context reloads
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setSelectedAvatar(user.avatar ?? null);
    }
  }, [user?.id]);

  // Lazy: the watchlist fetch plus up to six movie-detail fetches should not
  // fire on every Settings render, only once per profile being edited.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void avatarsService.loadLibraryStills(user.id).then((s) => {
      if (!cancelled) setLibraryStills(s);
    });
    return () => { cancelled = true; };
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
        avatar: selectedAvatar ?? '',
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
          <Avatar value={selectedAvatar} name={user.display_name} size="lg" />
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
          <AvatarPicker
            value={selectedAvatar}
            onChange={setSelectedAvatar}
            initials={getInitials(user.display_name)}
            libraryStills={libraryStills}
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setMaturity(settings.maturity_restriction);
    }
  }, [settings?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserSettings(userId, { maturity_restriction: maturity });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionHeading>Restrictions</SectionHeading>
      <form onSubmit={handleSave} className="space-y-5">
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
// Storage & playback (owner only, instance-wide)
// ---------------------------------------------------------------------------

export const StorageAndPlaybackSection: React.FC = () => {
  const [form, setForm] = useState<OwnerSettings | null>(null);
  const [days, setDays] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    instanceService
      .getOwnerSettings()
      .then((s) => {
        if (cancelled) return;
        setForm(s);
        setDays(String(s.autovacuum_days));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadFailed) {
    return (
      <Card>
        <SectionHeading>Storage &amp; playback</SectionHeading>
        <p role="alert" className="font-ui text-sm text-danger">
          Could not load storage &amp; playback settings.
        </p>
      </Card>
    );
  }

  if (!form) {
    return (
      <Card>
        <SectionHeading>Storage &amp; playback</SectionHeading>
      </Card>
    );
  }

  const patch = (p: Partial<OwnerSettings>) => setForm({ ...form, ...p });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(days);
    if (days.trim() === '' || !Number.isInteger(n) || n < 1 || n > 365) {
      setDaysError('Days must be a whole number from 1 to 365');
      return;
    }
    setDaysError(null);
    setSaving(true);
    try {
      const saved = await instanceService.updateOwnerSettings({ ...form, autovacuum_days: n });
      setForm(saved);
      setDays(String(saved.autovacuum_days));
      toast.success('Storage & playback saved');
    } catch {
      toast.error('Could not save storage & playback settings');
    } finally {
      setSaving(false);
    }
  };

  const vacuumOff = !form.autovacuum_enabled;

  return (
    <Card>
      <SectionHeading>Storage &amp; playback</SectionHeading>
      <form noValidate onSubmit={handleSave} className="space-y-5">
        <Toggle
          label="Delete untouched downloads automatically"
          checked={form.autovacuum_enabled}
          onChange={(v) => patch({ autovacuum_enabled: v })}
        />

        <Field
          label="Days untouched before deleting"
          htmlFor="autovacuum-days"
          hint="Runs daily at 4 am. Playing something resets its clock."
          error={daysError ?? undefined}
        >
          <Input
            id="autovacuum-days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={vacuumOff}
          />
        </Field>

        <Toggle
          label="Only once everyone who started it has watched"
          checked={form.autovacuum_watched_gate}
          onChange={(v) => patch({ autovacuum_watched_gate: v })}
          disabled={vacuumOff}
        />

        <Field label="Watched threshold" htmlFor="autovacuum-watched-pct">
          <div className="flex items-center gap-3">
            <input
              id="autovacuum-watched-pct"
              type="range"
              min={10}
              max={100}
              step={5}
              value={form.autovacuum_watched_pct}
              onChange={(e) => patch({ autovacuum_watched_pct: Number(e.target.value) })}
              disabled={vacuumOff || !form.autovacuum_watched_gate}
              className="w-full accent-gold"
            />
            <output className="font-ui text-sm text-text w-12 text-right">
              {form.autovacuum_watched_pct}%
            </output>
          </div>
        </Field>

        <Toggle
          label="Download the next episode automatically"
          checked={form.auto_next_enabled}
          onChange={(v) => patch({ auto_next_enabled: v })}
        />

        <Field label="Start the next episode at" htmlFor="auto-next-pct">
          <div className="flex items-center gap-3">
            <input
              id="auto-next-pct"
              type="range"
              min={50}
              max={95}
              step={5}
              value={form.auto_next_pct}
              onChange={(e) => patch({ auto_next_pct: Number(e.target.value) })}
              disabled={!form.auto_next_enabled}
              className="w-full accent-gold"
            />
            <output className="font-ui text-sm text-text w-12 text-right">
              {form.auto_next_pct}%
            </output>
          </div>
        </Field>

        <div className="flex justify-end">
          <Button type="submit" size="sm" isLoading={saving}>
            Save storage &amp; playback
          </Button>
        </div>
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
  const { account } = useSession();

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
          {canEdit && <ProfileLockSection userId={effectiveId} settings={userSettings} />}
        </>
      )}

      {account?.role === 'owner' && <StorageAndPlaybackSection />}
      <InstallCard />
      <SystemCard />
    </div>
  );
};

export default SettingsView;
