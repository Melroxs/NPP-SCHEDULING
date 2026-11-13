import { supabase } from '@/lib/supabase';
import type { GoogleCalendarEvent, FreeBusySlot, CalendarSyncLog } from '@/types/database';
import { SYSTEM_TZ } from '@/lib/timezone';

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
].join(' ');

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

function getRedirectUri(): string {
  return `${window.location.origin}/auth/google/callback`;
}

/**
 * Token exchange/refresh never happens in the browser: the OAuth client secret
 * and the refresh tokens live only on the server (google-oauth Edge Function).
 */
async function callGoogleOAuth<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('google-oauth', { body: payload });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error) throw new Error(body.error);
      } catch (parseError) {
        if (parseError instanceof Error) throw parseError;
      }
    }
    throw new Error('Google Calendar is unavailable. Please try again later.');
  }
  return data as T;
}

// ============================================
// OAUTH FLOW
// ============================================

export function getGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: state || '',
  });
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
}

// ============================================
// TOKEN MANAGEMENT
// ============================================

/**
 * Returns a short-lived Google access token for `userId`.
 * Refresh tokens are never exposed to the client.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  try {
    const { access_token } = await callGoogleOAuth<{ access_token: string | null }>({
      action: 'access_token',
      user_id: userId,
    });
    return access_token;
  } catch {
    return null;
  }
}

// ============================================
// CALENDAR API
// ============================================

export async function listCalendars(accessToken: string): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const response = await fetch(`${GOOGLE_API_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error('Failed to list calendars');
  const data = await response.json();
  return (data.items || []).map((cal: { id: string; summary: string; primary?: boolean }) => ({
    id: cal.id,
    summary: cal.summary,
    primary: cal.primary || false,
  }));
}

export async function getFreeBusy(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<Record<string, FreeBusySlot[]>> {
  const response = await fetch(`${GOOGLE_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: SYSTEM_TZ,
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  if (!response.ok) throw new Error('Failed to get FreeBusy data');
  const data = await response.json();

  const result: Record<string, FreeBusySlot[]> = {};
  for (const calId of calendarIds) {
    result[calId] = (data.calendars?.[calId]?.busy || []).map((slot: { start: string; end: string }) => ({
      start: slot.start,
      end: slot.end,
    }));
  }
  return result;
}

export async function getCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    timeZone: SYSTEM_TZ,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const response = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) throw new Error('Failed to get calendar events');
  const data = await response.json();

  return (data.items || []).map((event: Record<string, unknown>) => ({
    id: event.id,
    summary: event.summary || '',
    description: event.description || '',
    location: event.location || '',
    start: event.start,
    end: event.end,
    status: event.status,
  })) as GoogleCalendarEvent[];
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startTime: string;
    endTime: string;
  },
): Promise<GoogleCalendarEvent> {
  const response = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description || '',
        location: event.location || '',
        start: { dateTime: event.startTime, timeZone: SYSTEM_TZ },
        end: { dateTime: event.endTime, timeZone: SYSTEM_TZ },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create event: ${error.error?.message || 'Unknown error'}`);
  }

  return response.json();
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  updates: {
    summary?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
  },
): Promise<GoogleCalendarEvent> {
  const body: Record<string, unknown> = {};
  if (updates.summary) body.summary = updates.summary;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.location !== undefined) body.location = updates.location;
  if (updates.startTime) body.start = { dateTime: updates.startTime, timeZone: SYSTEM_TZ };
  if (updates.endTime) body.end = { dateTime: updates.endTime, timeZone: SYSTEM_TZ };

  const response = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update event: ${error.error?.message || 'Unknown error'}`);
  }

  return response.json();
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const response = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error('Failed to delete calendar event');
  }
}

// ============================================
// HIGH-LEVEL OPERATIONS
// ============================================

export async function connectGoogleCalendar(
  code: string,
): Promise<{ success: boolean; calendarId?: string; error?: string }> {
  try {
    const result = await callGoogleOAuth<{ connected: boolean; calendar_id: string }>({
      action: 'exchange',
      code,
      redirect_uri: getRedirectUri(),
    });
    return { success: true, calendarId: result.calendar_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect Google Calendar',
    };
  }
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  await callGoogleOAuth({ action: 'disconnect', user_id: userId });
}

export async function createAppointmentEvent(
  technicianId: string,
  appointmentId: string,
  customerName: string,
  appointmentType: string,
  phone: string,
  address: string,
  notes: string,
  startTime: string,
  endTime: string,
): Promise<string | null> {
  const accessToken = await getValidAccessToken(technicianId);
  if (!accessToken) return null;

  const { data: user } = await supabase
    .from('ss_users')
    .select('google_calendar_id')
    .eq('id', technicianId)
    .single();

  if (!user?.google_calendar_id) return null;

  try {
    const event = await createCalendarEvent(accessToken, user.google_calendar_id, {
      summary: `${customerName} - ${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)}`,
      description: [
        `Customer: ${customerName}`,
        `Phone: ${phone}`,
        `Address: ${address}`,
        `Notes: ${notes}`,
        '',
        'Created by New Paradigm Projects',
      ].join('\n'),
      location: address,
      startTime,
      endTime,
    });

    // Store event ID in appointment
    await supabase
      .from('ss_appointments')
      .update({
        google_calendar_event_id: event.id,
        google_calendar_id: user.google_calendar_id,
      })
      .eq('id', appointmentId);

    await logCalendarSync(technicianId, event.id, 'create', 'success');
    return event.id;
  } catch (error) {
    await logCalendarSync(technicianId, null, 'create', 'failed', String(error));
    return null;
  }
}

export async function updateAppointmentEvent(
  appointmentId: string,
  updates: {
    customerName?: string;
    appointmentType?: string;
    address?: string;
    notes?: string;
    startTime?: string;
    endTime?: string;
  },
): Promise<boolean> {
  const { data: appointment } = await supabase
    .from('ss_appointments')
    .select('technician_id, google_calendar_event_id, google_calendar_id')
    .eq('id', appointmentId)
    .single();

  if (!appointment?.google_calendar_event_id || !appointment?.google_calendar_id) {
    return false;
  }

  const accessToken = await getValidAccessToken(appointment.technician_id);
  if (!accessToken) return false;

  try {
    const eventUpdates: Record<string, string | undefined> = {};
    if (updates.customerName && updates.appointmentType) {
      eventUpdates.summary = `${updates.customerName} - ${updates.appointmentType.charAt(0).toUpperCase() + updates.appointmentType.slice(1)}`;
    }
    if (updates.address) eventUpdates.location = updates.address;
    if (updates.startTime) eventUpdates.startTime = updates.startTime;
    if (updates.endTime) eventUpdates.endTime = updates.endTime;

    await updateCalendarEvent(
      accessToken,
      appointment.google_calendar_id,
      appointment.google_calendar_event_id,
      eventUpdates,
    );

    await logCalendarSync(appointment.technician_id, appointment.google_calendar_event_id, 'update', 'success');
    return true;
  } catch (error) {
    await logCalendarSync(appointment.technician_id, appointment.google_calendar_event_id, 'update', 'failed', String(error));
    return false;
  }
}

export async function deleteAppointmentEvent(appointmentId: string): Promise<boolean> {
  const { data: appointment } = await supabase
    .from('ss_appointments')
    .select('technician_id, google_calendar_event_id, google_calendar_id')
    .eq('id', appointmentId)
    .single();

  if (!appointment?.google_calendar_event_id || !appointment?.google_calendar_id) {
    return false;
  }

  const accessToken = await getValidAccessToken(appointment.technician_id);
  if (!accessToken) return false;

  try {
    await deleteCalendarEvent(
      accessToken,
      appointment.google_calendar_id,
      appointment.google_calendar_event_id,
    );

    await supabase
      .from('ss_appointments')
      .update({ google_calendar_event_id: null, google_calendar_id: null })
      .eq('id', appointmentId);

    await logCalendarSync(appointment.technician_id, appointment.google_calendar_event_id, 'delete', 'success');
    return true;
  } catch (error) {
    await logCalendarSync(appointment.technician_id, appointment.google_calendar_event_id, 'delete', 'failed', String(error));
    return false;
  }
}

// ============================================
// HELPERS
// ============================================

async function logCalendarSync(
  userId: string,
  eventId: string | null,
  action: CalendarSyncLog['action'],
  status: CalendarSyncLog['status'],
  details?: string,
): Promise<void> {
  await supabase.from('ss_calendar_sync_logs').insert({
    user_id: userId,
    calendar_event_id: eventId,
    action,
    status,
    details,
  });
}

export async function getCalendarSyncLogs(userId: string, limit = 20): Promise<CalendarSyncLog[]> {
  const { data } = await supabase
    .from('ss_calendar_sync_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []) as CalendarSyncLog[];
}
