/**
 * Persistent RFC-4122 UUID v4 Identity Helper
 *
 * Backend FastAPI (api/routes/reports.py & api/routes/alerts.py) memvalidasi UUID(...)
 * secara ketat pada user_id, approved_by, rejected_by, dan deleted_by, serta memakai
 * UNIQUE(alert_id, user_id) untuk deduplikasi validasi komunitas.
 */

const PEDESTRIAN_STORAGE_KEY = 'teduh_pedestrian_uuid_v1';
const OPERATOR_STORAGE_KEY = 'teduh_pemkot_operator_uuid_v1';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const val = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

function getOrCreatePersistentUuid(storageKey: string): string {
  if (typeof window === 'undefined') {
    return generateUuidV4();
  }
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing && UUID_V4_REGEX.test(existing)) {
      return existing;
    }
    const created = generateUuidV4();
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return generateUuidV4();
  }
}

export function getPedestrianUserUuid(): string {
  return getOrCreatePersistentUuid(PEDESTRIAN_STORAGE_KEY);
}

export function getPemkotOperatorUuid(): string {
  return getOrCreatePersistentUuid(OPERATOR_STORAGE_KEY);
}

