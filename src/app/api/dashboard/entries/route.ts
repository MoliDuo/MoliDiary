import { NextResponse } from 'next/server';
import {
  buildTimelineEntriesPage,
  loadDashboardEntriesPage,
} from '@/lib/dashboard-data';
import { getSession } from '@/lib/auth/session';
import {
  InputValidationError,
  normalizeSearchQuery,
  normalizeTagFilter,
} from '@/lib/validation';
import { decodeEntryCursor } from '@/lib/pagination';

export async function GET(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const params = new URL(request.url).searchParams;
    const q = normalizeSearchQuery(params.get('q'));
    const tag = normalizeTagFilter(params.get('tag'));
    const cursorValue = params.get('cursor') ?? undefined;
    decodeEntryCursor(cursorValue);
    const page = await loadDashboardEntriesPage({
      q,
      tag,
      cursor: cursorValue,
    });
    return NextResponse.json(buildTimelineEntriesPage(page));
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error fetching dashboard entries:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
