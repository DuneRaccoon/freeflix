'use client';

import React, { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { UserSettings } from '@/services/users';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import UserAvatar from '@/components/users/UserAvatar';
import AvatarSelector from '@/components/users/AvatarSelector';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

interface UserSettingsPageProps {
  params: Promise<{ id: string }>;
}

const UserSettingsPage: React.FC<UserSettingsPageProps> = async ({ params }) => {
  const { id } = await params;
  const router = useRouter();
  const { 
    currentUser, 
    userSettings,
    users,
    isLoading,
    error,
    updateUser,
    updateUserSettings
  } = useUser();
  
  // User data states
  const [user, setUser] = useState(users.find(u => u.id === id) || null);
  const [displayName, setDisplayName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  
  // Settings states
  const [maturityRestriction, setMaturityRestriction] = useState<UserSettings['maturity_restriction']>('none');
  const [requirePasscode, setRequirePasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [theme, setTheme] = useState<UserSettings['theme']>('dark');
  const [defaultQuality, setDefaultQuality] = useState<UserSettings['default_quality']>('1080p');
  const [downloadPath, setDownloadPath] = useState('');
  
  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'restrictions'>('profile');
  
  // Load user and settings data
  useEffect(() => {
    const selectedUser = users.find(u => u.id === id);
    if (selectedUser) {
      setUser(selectedUser);
      setDisplayName(selectedUser.display_name);
      setSelectedAvatar(selectedUser.avatar);
    }
    
    // Load settings for the current user
    if (currentUser?.id === id && userSettings) {
      setMaturityRestriction(userSettings.maturity_restriction);
      setRequirePasscode(userSettings.require_passcode);
      setTheme(userSettings.theme);
      setDefaultQuality(userSettings.default_quality);
      setDownloadPath(userSettings.download_path || '');
    }
  }, [currentUser, userSettings, users, id]);
  
  // Handle saving profile changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!displayName.trim()) {
      setSettingsError('Display name is required');
      return;
    }
    
    try {
      setIsSubmitting(true);
      setSettingsError(null);
      
      await updateUser(id, {
        display_name: displayName.trim(),
        avatar: selectedAvatar || ''
      });
      
      toast.success('Profile updated successfully');
    } catch (err) {
      console.error('Error updating profile:', err);
      setSettingsError('Failed to update profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Handle saving restrictions
  const handleSaveRestrictions = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (requirePasscode && (!passcode.trim() || passcode !== confirmPasscode)) {
      setSettingsError(
        !passcode.trim() 
          ? 'Passcode is required when restriction is enabled' 
          : 'Passcodes do not match'
      );
      return;
    }
    
    try {
      setIsSubmitting(true);
      setSettingsError(null);
      
      const updatedSettings: Partial<UserSettings> = {
        maturity_restriction: maturityRestriction,
        require_passcode: requirePasscode
      };
      
      if (requirePasscode && passcode.trim()) {
        updatedSettings.passcode = passcode.trim();
      }
      
      await updateUserSettings(id, updatedSettings);
      
      // Clear passcode fields after saving
      setPasscode('');
      setConfirmPasscode('');
      
      toast.success('Content restrictions updated successfully');
    } catch (err) {
      console.error('Error updating restrictions:', err);
      setSettingsError('Failed to update restrictions. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Handle saving preferences
  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      setSettingsError(null);
      
      await updateUserSettings(id, {
        theme,
        default_quality: defaultQuality,
        download_path: downloadPath.trim() || undefined
      });
      
      toast.success('Preferences updated successfully');
    } catch (err) {
      console.error('Error updating preferences:', err);
      setSettingsError('Failed to update preferences. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Check if user is allowed to edit this profile
  const canEdit = currentUser?.id === id;
  
  // If loading
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-lg">Loading user settings...</p>
      </div>
    );
  }
  
  // If user not found
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <h2 className="text-2xl font-bold text-red-500 mb-4">User not found</h2>
        <Button onClick={() => router.push('/')}>Go Back</Button>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">User Settings</h1>
      
      {/* Tabs */}
      <div className="flex mb-6 border-b border-gray-700">
        <button 
          className={`py-2 px-4 font-medium ${activeTab === 'profile' 
            ? 'text-primary-500 border-b-2 border-primary-500' 
            : 'text-gray-400 hover:text-white'}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button 
          className={`py-2 px-4 font-medium ${activeTab === 'preferences' 
            ? 'text-primary-500 border-b-2 border-primary-500' 
            : 'text-gray-400 hover:text-white'}`}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
        <button 
          className={`py-2 px-4 font-medium ${activeTab === 'restrictions' 
            ? 'text-primary-500 border-b-2 border-primary-500' 
            : 'text-gray-400 hover:text-white'}`}
          onClick={() => setActiveTab('restrictions')}
        >
          Content Restrictions
        </button>
      </div>
      
      {/* Tab Content */}
      <div className="mb-8">
        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle>Edit Profile</CardTitle>
            </CardHeader>
            <form onSubmit={handleSaveProfile}>
              <CardContent className="space-y-6">
                {settingsError && (
                  <div className="bg-red-900/20 border border-red-800 rounded p-3 text-red-400">
                    {settingsError}
                  </div>
                )}
                
                <div className="flex flex-col md:flex-row gap-6 items-center">
                  <div className="flex-shrink-0">
                    <UserAvatar user={user} size="xl" />
                  </div>
                  
                  <div className="flex-grow">
                    <Input
                      label="Display Name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={!canEdit}
                    />
                    
                    <p className="text-sm text-gray-400 mt-2">
                      Username: {user.username}
                    </p>
                  </div>
                </div>
                
                {canEdit && (
                  <div>
                    <AvatarSelector
                      selectedAvatar={selectedAvatar}
                      onChange={setSelectedAvatar}
                    />
                  </div>
                )}
              </CardContent>
              
              <CardFooter>
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/')}
                  >
                    Cancel
                  </Button>
                  
                  {canEdit && (
                    <Button
                      type="submit"
                      variant="primary"
                      isLoading={isSubmitting}
                    >
                      Save Changes
                    </Button>
                  )}
                </div>
              </CardFooter>
            </form>
          </Card>
        )}
        
        {/* Preferences Tab */}
        {activeTab === 'preferences' && (
          <Card>
            <CardHeader>
              <CardTitle>User Preferences</CardTitle>
            </CardHeader>
            <form onSubmit={handleSavePreferences}>
              <CardContent className="space-y-6">
                {settingsError && (
                  <div className="bg-red-900/20 border border-red-800 rounded p-3 text-red-400">
                    {settingsError}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Select
                    label="Theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
                    options={[
                      { value: 'dark', label: 'Dark Theme' },
                      { value: 'light', label: 'Light Theme' }
                    ]}
                    disabled={!canEdit}
                  />
                  
                  <Select
                    label="Default Quality"
                    value={defaultQuality}
                    onChange={(e) => setDefaultQuality(e.target.value as '720p' | '1080p' | '2160p')}
                    options={[
                      { value: '720p', label: '720p' },
                      { value: '1080p', label: '1080p' },
                      { value: '2160p', label: '2160p (4K)' }
                    ]}
                    disabled={!canEdit}
                  />
                </div>
                
                <Input
                  label="Download Path (Optional)"
                  value={downloadPath}
                  onChange={(e) => setDownloadPath(e.target.value)}
                  placeholder="/path/to/downloads"
                  disabled={!canEdit}
                />
                
                <div className="text-sm text-gray-400">
                  <p>If no download path is specified, the system default will be used.</p>
                </div>
              </CardContent>
              
              <CardFooter>
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/')}
                  >
                    Cancel
                  </Button>
                  
                  {canEdit && (
                    <Button
                      type="submit"
                      variant="primary"
                      isLoading={isSubmitting}
                    >
                      Save Preferences
                    </Button>
                  )}
                </div>
              </CardFooter>
            </form>
          </Card>
        )}
        
        {/* Content Restrictions Tab */}
        {activeTab === 'restrictions' && (
          <Card>
            <CardHeader>
              <CardTitle>Content Restrictions</CardTitle>
            </CardHeader>
            <form onSubmit={handleSaveRestrictions}>
              <CardContent className="space-y-6">
                {settingsError && (
                  <div className="bg-red-900/20 border border-red-800 rounded p-3 text-red-400">
                    {settingsError}
                  </div>
                )}
                
                <Select
                  label="Content Restriction Level"
                  value={maturityRestriction}
                  onChange={(e) => setMaturityRestriction(e.target.value as UserSettings['maturity_restriction'])}
                  options={[
                    { value: 'none', label: 'No Restrictions' },
                    { value: 'pg', label: 'PG and Below' },
                    { value: 'pg13', label: 'PG-13 and Below' },
                    { value: 'r', label: 'R and Below' }
                  ]}
                  disabled={!canEdit}
                />
                
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="require-passcode"
                    checked={requirePasscode}
                    onChange={(e) => setRequirePasscode(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    disabled={!canEdit}
                  />
                  <label htmlFor="require-passcode" className="text-sm font-medium text-gray-300">
                    Require passcode for restricted content
                  </label>
                </div>
                
                {requirePasscode && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      type="password"
                      label="Passcode"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      disabled={!canEdit}
                    />
                    
                    <Input
                      type="password"
                      label="Confirm Passcode"
                      value={confirmPasscode}
                      onChange={(e) => setConfirmPasscode(e.target.value)}
                      disabled={!canEdit}
                    />
                  </div>
                )}
                
                <div className="text-sm text-gray-400">
                  <h4 className="font-medium mb-1">Restriction Levels:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>No Restrictions:</strong> All content is allowed without confirmation.</li>
                    <li><strong>PG and Below:</strong> Requires passcode for PG-13 and R rated content.</li>
                    <li><strong>PG-13 and Below:</strong> Requires passcode for R rated content.</li>
                    <li><strong>R and Below:</strong> All content is allowed, but still requires passcode if enabled.</li>
                  </ul>
                </div>
              </CardContent>
              
              <CardFooter>
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/')}
                  >
                    Cancel
                  </Button>
                  
                  {canEdit && (
                    <Button
                      type="submit"
                      variant="primary"
                      isLoading={isSubmitting}
                    >
                      Save Restrictions
                    </Button>
                  )}
                </div>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
};

export default UserSettingsPage;