'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { toast } from 'react-hot-toast';

// This is a placeholder settings page, as we don't have a settings API yet
// In a real implementation, we would fetch and update settings from the backend

export default function SettingsPage() {
  const [downloadPath, setDownloadPath] = useState('/opt/yify_downloader/downloads');
  const [maxDownloads, setMaxDownloads] = useState(3);
  const [isLoading, setIsLoading] = useState(false);

  // Handle save settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsLoading(true);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setIsLoading(false);
    }
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
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Version</span>
              <span className="font-medium">1.0.0</span>
            </div>
            
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Platform</span>
              <span className="font-medium">Raspberry Pi 5</span>
            </div>
            
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">API Status</span>
              <span className="font-medium text-green-500">Connected</span>
            </div>
            
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Torrent Client</span>
              <span className="font-medium">LibTorrent 1.2.8</span>
            </div>
          </div>
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