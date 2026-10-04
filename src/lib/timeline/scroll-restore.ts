/**
 * Remembers how far the timeline was scrolled, and how many pages were loaded.
 *
 * EntriesTimelineClient unmounts when you open an entry, so coming back
 * remounts it with only the server's first page — after scrolling back through
 * months, that drops you at the top. This records both numbers per filter and
 * replays them on mount.
 */
const STORAGE_PREFIX = 'diary:timeline:';

export type TimelinePosition = { size: number; offset: number };

export function timelineStateKey(query?: string, tag?: string) {
  return `${STORAGE_PREFIX}${query ?? ''}|${tag ?? ''}`;
}

export function serializeTimelinePosition(position: TimelinePosition) {
  return JSON.stringify(position);
}

export function parseTimelinePosition(
  value: string | null,
  maxSize = 50,
): TimelinePosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const size = Number(parsed.size);
    const offset = Number(parsed.offset);
    if (!Number.isFinite(size) || !Number.isFinite(offset)) return null;
    if (size < 1 || offset < 0) return null;
    // A corrupted or hand-edited value must not make the page fetch forever.
    return { size: Math.min(Math.floor(size), maxSize), offset };
  } catch {
    return null;
  }
}

export function readTimelinePosition(key: string): TimelinePosition | null {
  try {
    return parseTimelinePosition(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeTimelinePosition(key: string, position: TimelinePosition) {
  try {
    sessionStorage.setItem(key, serializeTimelinePosition(position));
  } catch {
    // Private mode or a full quota: losing the position is not worth an error.
  }
}
