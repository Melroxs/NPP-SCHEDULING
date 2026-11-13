import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { requestNotificationPermission } from '@/lib/firebase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, X } from 'lucide-react';

const DISMISSED_KEY = 'summit-notif-onboard-dismissed';

export function NotificationOnboarding() {
  const { profile } = useAuthStore();
  const [requesting, setRequesting] = useState(false);
  // Resolved once on mount instead of being set from an effect, which avoids a
  // second render pass just to reveal the banner.
  const [show, setShow] = useState<boolean>(() => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return false;
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return false;
    return true;
  });

  if (!show || !profile) return null;

  const handleEnable = async () => {
    if (!profile) return;
    setRequesting(true);
    await requestNotificationPermission(profile.id);
    setRequesting(false);
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setShow(false);
  };

  return (
    <Card className="border-primary/20 mb-6">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Bell className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Enable notifications to receive appointment updates.</p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" className="mt-3 w-full" onClick={handleEnable} disabled={requesting}>
          {requesting ? 'Requesting...' : 'Enable Notifications'}
        </Button>
      </CardContent>
    </Card>
  );
}
