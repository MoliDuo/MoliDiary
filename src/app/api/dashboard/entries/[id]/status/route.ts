import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { findActiveEntry } from '@/lib/db/entries-repo';
import { normalizeAIStatus, type AIStatus } from '@/lib/ai/polling';

type StatusRouteDependencies = {
  authorize: () => unknown | Promise<unknown>;
  loadStatus: (
    id: string,
  ) => AIStatus | undefined | Promise<AIStatus | undefined>;
};

export function createEntryStatusHandler({
  authorize,
  loadStatus,
}: StatusRouteDependencies) {
  return async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    if (!(await authorize())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const aiStatus = await loadStatus(id);
    if (aiStatus === undefined) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    return NextResponse.json({ aiStatus });
  };
}

export const GET = createEntryStatusHandler({
  authorize: getSession,
  async loadStatus(id) {
    const entry = await findActiveEntry(id);
    return entry ? normalizeAIStatus(entry.aiStatus) : undefined;
  },
});
