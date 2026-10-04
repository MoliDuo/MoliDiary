import type { Metadata } from 'next';
import { getEntryById } from '@/lib/entry-data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { FormattedDate } from '@/components/FormattedDate';
import { EntryDetailActions } from '@/components/EntryDetailActions';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';
import { dashboardPath } from '@/lib/pathname';
import {
  EntryTagsEditor,
  EntryTitleEditor,
} from '@/components/EntryMetadataEditor';
import { PendingAIRefresh } from '@/components/PendingAIRefresh';

export function buildEntryDetailViewModel(
  entry: {
    content: string;
    title: string | null;
    summary: string | null;
    tags: string[];
    aiStatus: string | null;
    createdAt: Date | null;
  },
  copy: typeof messages,
) {
  return {
    ...entry,
    displayTitle: entry.title || copy.editor.untitledCapture,
    summary: entry.summary,
    statusLabel:
      entry.aiStatus === 'failed'
        ? copy.common.failed
        : entry.aiStatus === 'pending'
          ? copy.common.processing
          : null,
    statusTone: entry.aiStatus === 'failed' ? 'danger' : 'muted',
    regenerateLabel: copy.entryDetail.regenerateMetadata,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const entry = await getEntryById(id);
  return {
    title: entry?.title || messages.editor.untitledCapture,
  };
}

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const entry = await getEntryById(id);

  if (!entry) {
    notFound();
  }

  const viewModel = buildEntryDetailViewModel(entry, messages);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {entry.aiStatus === 'pending' ? (
        <PendingAIRefresh entryId={entry.id} />
      ) : null}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="-ml-3 text-muted hover:text-text"
        >
          <Link href={dashboardPath()} aria-label={messages.common.timeline}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <EntryDetailActions
          entryId={id}
          pending={entry.aiStatus === 'pending'}
        />
      </div>

      <article className="space-y-10">
        <header className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
            <FormattedDate date={entry.createdAt} />
            {viewModel.statusLabel && (
              <span
                className={
                  viewModel.statusTone === 'danger'
                    ? 'inline-flex items-center gap-1.5 text-danger'
                    : 'inline-flex items-center gap-1.5 text-primary'
                }
              >
                {entry.aiStatus === 'pending' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                )}
                {viewModel.statusLabel}
              </span>
            )}
          </div>

          <EntryTitleEditor
            entryId={entry.id}
            title={viewModel.displayTitle}
            locked={entry.titleLockedAt !== null}
          />

          {viewModel.summary && (
            <div className="border-l-2 border-border pl-4">
              <p className="font-mono text-xs text-muted">
                {messages.entryDetail.aiSummary}
              </p>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                {viewModel.summary}
              </p>
            </div>
          )}

          <EntryTagsEditor
            entryId={entry.id}
            tags={viewModel.tags}
            locked={entry.tagsLockedAt !== null}
          />
        </header>

        <div className="border-t border-border pt-10">
          <MarkdownContent>{entry.content}</MarkdownContent>
        </div>
      </article>
    </div>
  );
}
