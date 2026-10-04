import Link from 'next/link';
import { EntriesTimelineClient } from '@/components/EntriesTimelineClient';
import {
  buildTimelineEntriesPage,
  loadDashboardEntriesPage,
} from '@/lib/dashboard-data';
import { messages } from '@/lib/messages';
import { dashboardPath, newEntryPath } from '@/lib/pathname';
import { normalizeSearchQuery, normalizeTagFilter } from '@/lib/validation';
import { X } from 'lucide-react';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const { q: rawQuery, tag: rawTag } = await searchParams;
  const q = normalizeSearchQuery(rawQuery);
  const tag = normalizeTagFilter(rawTag);
  const initialPage = buildTimelineEntriesPage(
    await loadDashboardEntriesPage({ q, tag }),
  );

  return (
    <div className="space-y-6">
      {tag ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-md border border-border px-2.5 font-mono text-xs text-text">
            {messages.dashboard.filteredByTag(tag)}
          </span>
          <Link
            href={dashboardPath()}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface2 hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
            {messages.dashboard.clearTagFilter}
          </Link>
        </div>
      ) : null}

      {initialPage.items.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
          <p className="text-sm text-muted">
            {q
              ? messages.dashboard.noSearchResults
              : messages.dashboard.emptyMessage}
          </p>
          {q ? (
            <Link
              href={dashboardPath()}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface2 hover:text-text"
            >
              <X className="h-4 w-4" />
              {messages.dashboard.clearSearch}
            </Link>
          ) : (
            <Link
              href={newEntryPath()}
              className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-accent-fg transition-opacity hover:opacity-85"
            >
              {messages.dashboard.createFirstEntry}
            </Link>
          )}
        </div>
      ) : (
        <EntriesTimelineClient
          key={`${q ?? ''}|${tag ?? ''}`}
          initialPage={initialPage}
          query={q}
          tag={tag}
        />
      )}
    </div>
  );
}
