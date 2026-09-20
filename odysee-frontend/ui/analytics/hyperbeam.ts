import { ODYSEE_ANALYTICS_TRACKING_KEY } from 'config';
import { HYPERBEAM_DEVICE, hyperbeamDeviceBase } from 'util/hyperbeamDevices';

const MAX_COUNTS_PER_REQUEST = 100;

export type EngagementEvent = 'start' | 'heartbeat' | 'pause' | 'complete' | 'end';

export type EngagementInput = {
  subjectId: string;
  interactionId: string;
  event: EngagementEvent;
  sequence: number;
  activeMs: number;
  positionMs: number;
};

type CountResponse = {
  'subject-id': string;
  total: number;
};

function trackingKey() {
  return String(ODYSEE_ANALYTICS_TRACKING_KEY || '').trim();
}

function analyticsBase() {
  return hyperbeamDeviceBase(HYPERBEAM_DEVICE.analytics);
}

function viewCountBase() {
  return hyperbeamDeviceBase(HYPERBEAM_DEVICE.file);
}

export function analyticsTrackingEnabled() {
  return Boolean(trackingKey() && analyticsBase());
}

async function analyticsPost(path: string, body: Record<string, unknown>, keepalive = false) {
  const base = analyticsBase();
  const key = trackingKey();
  if (!base || !key) return null;

  const response = await fetch(`${base}/${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ key, ...body }),
    keepalive,
  });

  if (!response.ok) {
    throw new Error(`analytics@1.0/${path} returned ${response.status}`);
  }

  return response.json();
}

export async function sendAnalyticsEngagement(input: EngagementInput, keepalive = false) {
  if (!analyticsTrackingEnabled()) return;

  await analyticsPost(
    'engagement',
    {
      'subject-id': input.subjectId,
      'interaction-id': input.interactionId,
      event: input.event,
      sequence: input.sequence,
      'active-ms': input.activeMs,
      'position-ms': input.positionMs,
    },
    keepalive
  );
}

export async function sendAnalyticsEvent(
  name: string,
  subjectId?: string,
  keepalive = false,
  type: 'event' | 'action' = 'event'
) {
  if (!analyticsTrackingEnabled()) return;

  const eventName = String(name || '').trim();
  if (!eventName) return;

  const body: Record<string, unknown> = {
    name: eventName,
    type,
  };

  if (subjectId) body['subject-id'] = subjectId;
  if (typeof window !== 'undefined') body.page = `${window.location.pathname}${window.location.search}`;

  await analyticsPost('event', body, keepalive);
}

export function sendAnalyticsAction(name: string, subjectId?: string, keepalive = false) {
  return sendAnalyticsEvent(name, subjectId, keepalive, 'action');
}

export async function fetchAnalyticsCounts(subjectIds: string[]) {
  const orderedIds = subjectIds.map(String).filter(Boolean);
  if (orderedIds.length === 0) return [];
  const base = viewCountBase();
  const key = trackingKey();
  if (!base || !key) return orderedIds.map(() => 0);

  const totals = new Map<string, number>();
  const uniqueIds = Array.from(new Set(orderedIds));

  for (let index = 0; index < uniqueIds.length; index += MAX_COUNTS_PER_REQUEST) {
    const chunk = uniqueIds.slice(index, index + MAX_COUNTS_PER_REQUEST);
    const response = await fetch(`${base}/view-count`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ key, 'claim-ids': chunk }),
    });
    if (!response.ok) throw new Error(`odysee-file@1.0/view-count returned ${response.status}`);
    const result = await response.json();
    const counts: CountResponse[] = Array.isArray(result?.counts) ? result.counts : [];

    counts.forEach((count) => {
      totals.set(String(count['subject-id']), Number(count.total) || 0);
    });
  }

  return orderedIds.map((subjectId) => totals.get(subjectId) || 0);
}

let pageTrackerInstalled = false;

export function installAnalyticsPageTracker() {
  if (pageTrackerInstalled || !analyticsTrackingEnabled() || typeof document === 'undefined') return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `${analyticsBase()}/script?key=${encodeURIComponent(trackingKey())}`;
  script.dataset.hyperbeamAnalytics = 'true';
  document.head.appendChild(script);
  pageTrackerInstalled = true;
}
