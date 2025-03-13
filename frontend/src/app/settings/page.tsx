'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { toast } from 'react-hot-toast';
import { baseService } from '@/services/api-client';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

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

export default function SettingsPage() {
  const [downloadPath, setDownloadPath] = useState('/opt/freeflix/downloads');
  const [maxDownloads, setMaxDownloads] = useState(3);
  const [isLoading, setIsLoading] = useState(false);
  
  // System info states
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [isSystemInfoLoading, setIsSystemInfoLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Fetch system info on component mount
  useEffect(() => {
    fetchSystemInfo();
  }, []);

  // Function to fetch system info and health status
  const fetchSystemInfo = async () => {
    setIsSystemInfoLoading(true);
    setApiError(null);
    
    try {
      // Fetch both system info and health check in parallel
      const [rootResponse, healthResponse] = await Promise.all([
        baseService.root(),
        baseService.healthcheck()
      ]);
      
      setSystemInfo(rootResponse);
      setHealthInfo(healthResponse);
    } catch (error) {
      console.error('Error fetching system information:', error);
      setApiError('Failed to connect to API. Please check if the service is running.');
    } finally {
      setIsSystemInfoLoading(false);
    }
  };

  // Handle save settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsLoading(true);
      
      // Simulate API call - in a real implementation, we would call the API here
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle refresh button click
  const handleRefreshSystemInfo = () => {
    fetchSystemInfo();
    toast.success('Refreshing system information');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      
      <Card>
        <form onSubmit={handleSaveSettings}>
          <CardHeader>
            <CardTitle>Download Settings</CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <Input
              label="Download Path"
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              placeholder="/path/to/downloads"
            />
            
            <Input
              type="number"
              label="Maximum Concurrent Downloads"
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(parseInt(e.target.value))}
              min={1}
              max={10}
            />
            
            <div className="flex items-center mt-4">
              <input
                type="checkbox"
                id="seed-toggle"
                className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="seed-toggle" className="ml-2 text-sm text-gray-300">
                Seed after download completes
              </label>
            </div>
            
            <div className="flex items-center mt-2">
              <input
                type="checkbox"
                id="sequential-toggle"
                className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-primary-600 focus:ring-primary-500"
                defaultChecked
              />
              <label htmlFor="sequential-toggle" className="ml-2 text-sm text-gray-300">
                Enable sequential downloading
              </label>
            </div>
          </CardContent>
          
          <CardFooter>
            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
            >
              Save Settings
            </Button>
          </CardFooter>
        </form>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>System Information</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowPathIcon className="w-4 h-4" />}
            onClick={handleRefreshSystemInfo}
            isLoading={isSystemInfoLoading}
          >
            Refresh
          </Button>
        </CardHeader>
        
        <CardContent>
          {apiError ? (
            <div className="bg-red-900/20 border border-red-900 rounded p-4 text-red-400">
              {apiError}
            </div>
          ) : isSystemInfoLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="flex justify-between py-2 border-b border-gray-800">
                <div className="h-4 bg-gray-700 rounded w-20"></div>
                <div className="h-4 bg-gray-700 rounded w-24"></div>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <div className="h-4 bg-gray-700 rounded w-20"></div>
                <div className="h-4 bg-gray-700 rounded w-32"></div>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <div className="h-4 bg-gray-700 rounded w-20"></div>
                <div className="h-4 bg-gray-700 rounded w-24"></div>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-800">
                <div className="h-4 bg-gray-700 rounded w-20"></div>
                <div className="h-4 bg-gray-700 rounded w-32"></div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Service</span>
                <span className="font-medium">{systemInfo?.service || 'Unknown'}</span>
              </div>
              
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Platform</span>
                <span className="font-medium">{systemInfo?.platform || 'Unknown'} ({systemInfo?.hardware || 'Unknown'})</span>
              </div>
              
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">API Status</span>
                <span className={`font-medium ${healthInfo?.status === 'healthy' ? 'text-green-500' : 'text-yellow-500'}`}>
                  {healthInfo?.status === 'healthy' ? 'Connected' : 'Warning'}
                </span>
              </div>
              
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Active Torrents</span>
                <span className="font-medium">{healthInfo?.active_torrents || 0}</span>
              </div>
              
              <div className="flex justify-between py-2 border-b border-gray-800">
                <span className="text-gray-400">Scheduler</span>
                <span className="font-medium">{healthInfo?.scheduler_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        
        <CardContent className="flex flex-wrap gap-4">
          <Button variant="outline">Restart Torrent Service</Button>
          <Button variant="outline">Clear Cache</Button>
          <Button variant="danger">Reset All Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}