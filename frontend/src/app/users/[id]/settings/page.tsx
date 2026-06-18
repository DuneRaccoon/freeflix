import SettingsView from '@/components/settings/SettingsView';

interface UserSettingsPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserSettingsPage({ params }: UserSettingsPageProps) {
  const { id } = await params;
  return <SettingsView userId={id} />;
}
