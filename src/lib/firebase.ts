import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { supabase } from './supabase';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
);

// Cached as a promise: concurrent callers must not initialise the default app twice.
let messagingPromise: Promise<Messaging | null> | null = null;

function getMessagingInstance(): Promise<Messaging | null> {
  if (!isFirebaseConfigured) return Promise.resolve(null);

  messagingPromise ??= (async () => {
    try {
      const supported = await isSupported();
      if (!supported) return null;
      const app = initializeApp(firebaseConfig);
      return getMessaging(app);
    } catch {
      return null;
    }
  })();

  return messagingPromise;
}

export async function requestNotificationPermission(userId: string): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const msg = await getMessagingInstance();
    if (!msg) return null;

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(msg, { vapidKey });

    if (token) {
      await saveDeviceToken(userId, token);
    }
    return token;
  } catch {
    return null;
  }
}

async function saveDeviceToken(userId: string, token: string) {
  const platform = /Android/i.test(navigator.userAgent) ? 'android'
    : /iPad|iPhone|iPod/i.test(navigator.userAgent) ? 'ios'
    : 'web';

  const { data: existing } = await supabase
    .from('ss_device_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('token', token)
    .maybeSingle();

  if (!existing) {
    await supabase.from('ss_device_tokens').insert({
      user_id: userId,
      token,
      platform,
    });
  }
}

export function onForegroundMessage(callback: (payload: { title?: string; body?: string }) => void) {
  void getMessagingInstance().then((msg) => {
    if (!msg) return;
    onMessage(msg, (payload) => {
      callback({
        title: payload.notification?.title,
        body: payload.notification?.body,
      });
    });
  });
}
