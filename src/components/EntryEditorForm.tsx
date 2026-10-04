'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createEntry, updateEntry } from '@/lib/actions/entries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '@/components/MarkdownContent';
import {
  EntryEditorShell,
  buildEntryEditorShellModel,
} from '@/components/EntryEditorShell';
import { messages } from '@/lib/messages';
import {
  type DraftStatus,
  describeDraftStatus,
  entryDraftKey,
  hasEntryDraftChanges,
  parseEntryDraft,
  serializeEntryDraft,
} from '@/lib/entry-draft';
import { describeContentLength, isEntrySubmittable } from '@/lib/entry-editor';
import { isSaveShortcut } from '@/lib/keyboard';
import type { EditorFontSize } from '@/lib/settings-core';
import { cn } from '@/lib/utils';
import { formatTimestampInTimeZone } from '@/lib/format';

const DRAFT_SAVE_DELAY_MS = 500;
const DRAFT_STORAGE_ERROR = '__diary_draft_storage_error__';

export function EntryEditorForm({
  mode,
  entryId,
  initialContent = '',
  initialCreatedAt,
  timeZone,
  editorFontSize = 'medium',
}: {
  mode: 'create' | 'edit';
  entryId?: string;
  initialContent?: string;
  initialCreatedAt: string;
  timeZone: string;
  editorFontSize?: EditorFontSize;
}) {
  const router = useRouter();
  const [contentOverride, setContentOverride] = useState<string>();
  const [createdAtOverride, setCreatedAtOverride] = useState<string>();
  const [error, setError] = useState<string>();
  const [draftStatus, setDraftStatus] = useState<DraftStatus>();
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = entryDraftKey(mode, entryId);
  const subscribeToDraft = useCallback(
    (onStoreChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === draftKey) onStoreChange();
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    },
    [draftKey],
  );
  const getDraftSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return DRAFT_STORAGE_ERROR;
    }
  }, [draftKey]);
  const rawDraft = useSyncExternalStore(
    subscribeToDraft,
    getDraftSnapshot,
    () => null,
  );
  const restoredDraft = useMemo(
    () => (rawDraft === DRAFT_STORAGE_ERROR ? null : parseEntryDraft(rawDraft)),
    [rawDraft],
  );
  const shouldRestoreDraft = Boolean(
    !draftDismissed &&
    restoredDraft &&
    hasEntryDraftChanges(
      restoredDraft.content,
      restoredDraft.createdAt,
      initialContent,
      initialCreatedAt,
    ),
  );
  const content =
    contentOverride ??
    (shouldRestoreDraft ? restoredDraft?.content : undefined) ??
    initialContent;
  const createdAt =
    createdAtOverride ??
    (shouldRestoreDraft ? restoredDraft?.createdAt : undefined) ??
    initialCreatedAt;
  const latestDraftRef = useRef({
    content: initialContent,
    createdAt: initialCreatedAt,
  });
  const draftChangedRef = useRef(false);
  const effectiveDraftStatus: DraftStatus =
    draftStatus ??
    (rawDraft === DRAFT_STORAGE_ERROR
      ? { kind: 'error', reason: 'read' }
      : shouldRestoreDraft
        ? { kind: 'restored' }
        : { kind: 'idle' });
  const visibleDraftStatus = describeDraftStatus(
    effectiveDraftStatus,
    messages.editor,
    (date) => formatTimestampInTimeZone(date, timeZone),
  );
  const contentLength = describeContentLength(content.length, messages.editor);
  const canSubmit = isEntrySubmittable({
    content,
    overLimit: contentLength.overLimit,
    pending: isPending,
  });
  const shell = buildEntryEditorShellModel({ mode });

  const persistDraft = useCallback(() => {
    if (!draftChangedRef.current) return;
    try {
      const latest = latestDraftRef.current;
      if (
        !hasEntryDraftChanges(
          latest.content,
          latest.createdAt,
          initialContent,
          initialCreatedAt,
        )
      ) {
        localStorage.removeItem(draftKey);
        draftChangedRef.current = false;
        setDraftStatus({ kind: 'cleared' });
        return;
      }
      const savedAt = new Date();
      localStorage.setItem(
        draftKey,
        serializeEntryDraft(latest.content, latest.createdAt, savedAt),
      );
      setDraftStatus({ kind: 'saved', savedAt });
    } catch {
      setDraftStatus({ kind: 'error', reason: 'save' });
    }
  }, [draftKey, initialContent, initialCreatedAt]);

  function discardDraft() {
    try {
      localStorage.removeItem(draftKey);
      setDraftDismissed(true);
      setContentOverride(initialContent);
      setCreatedAtOverride(initialCreatedAt);
      latestDraftRef.current = {
        content: initialContent,
        createdAt: initialCreatedAt,
      };
      draftChangedRef.current = false;
      setDraftStatus({ kind: 'discarded' });
    } catch {
      setDraftStatus({ kind: 'error', reason: 'discard' });
    }
  }

  useEffect(() => {
    if (!draftChangedRef.current) return;
    const timeout = window.setTimeout(persistDraft, DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [content, createdAt, persistDraft]);

  useEffect(() => {
    const flush = () => persistDraft();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [persistDraft]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    draftChangedRef.current = true;
    persistDraft();
    const formData = new FormData(event.currentTarget);
    setError(undefined);
    startTransition(async () => {
      try {
        const result =
          mode === 'create'
            ? await createEntry(formData)
            : await updateEntry(entryId as string, formData);
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        try {
          localStorage.removeItem(draftKey);
          draftChangedRef.current = false;
        } catch {
          // A stale local draft is safer than losing a failed save.
        }
        toast.success(
          mode === 'create'
            ? '记录已保存，正在整理'
            : '修改已保存，正在重新整理',
        );
        router.push(result.data.redirectTo);
      } catch {
        const message = '保存失败，请重试';
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <EntryEditorShell
      title={shell.title}
      metaLabel={contentLength.text}
      metaTone={contentLength.tone}
    >
      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (!isSaveShortcut(event) || !canSubmit) return;
          event.preventDefault();
          formRef.current?.requestSubmit();
        }}
        className="flex min-h-[640px] flex-col md:min-h-[72vh]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
          <label htmlFor="entry-created-at" className="sr-only">
            {messages.editor.time}
          </label>
          <Input
            id="entry-created-at"
            name="createdAt"
            type="date"
            value={createdAt}
            onChange={(event) => {
              draftChangedRef.current = true;
              setDraftStatus({ kind: 'saving' });
              latestDraftRef.current = {
                content,
                createdAt: event.target.value,
              };
              setCreatedAtOverride(event.target.value);
            }}
            className="h-8 w-auto max-w-56 border-transparent bg-surface2 px-2.5 font-mono text-xs"
            disabled={isPending}
            required
          />
          <div
            role="group"
            aria-label={messages.editor.preview}
            className="ml-auto inline-flex rounded-md bg-surface2 p-0.5"
          >
            {(
              [
                [false, messages.editor.write, Pencil],
                [true, messages.editor.preview, Eye],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={label}
                type="button"
                aria-pressed={showPreview === value}
                onClick={() => setShowPreview(value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs transition-colors [&_svg]:size-3.5',
                  showPreview === value
                    ? 'bg-bg font-medium text-text ring-1 ring-border'
                    : 'text-muted hover:text-text',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <label htmlFor="entry-content" className="sr-only">
          {messages.editor.content}
        </label>
        {/* The textarea stays mounted while previewing so its value is still
            submitted and the browser keeps undo history and cursor position. */}
        <Textarea
          id="entry-content"
          name="content"
          required
          value={content}
          onChange={(event) => {
            draftChangedRef.current = true;
            setDraftStatus({ kind: 'saving' });
            latestDraftRef.current = {
              content: event.target.value,
              createdAt,
            };
            setContentOverride(event.target.value);
          }}
          placeholder={
            mode === 'create' ? messages.editor.contentPlaceholder : undefined
          }
          className={cn(
            'flex-1 resize-none rounded-none border-0 bg-transparent p-4 leading-8 hover:border-0 focus-visible:ring-0 md:px-6 md:py-5',
            showPreview && 'hidden',
            editorFontSize === 'small' && 'text-base',
            editorFontSize === 'medium' && 'text-lg',
            editorFontSize === 'large' && 'text-xl',
          )}
          autoFocus={mode === 'create'}
          disabled={isPending}
        />
        {showPreview ? (
          <div className="flex-1 overflow-y-auto p-4 md:px-6 md:py-5">
            {content.trim() ? (
              <MarkdownContent>{content}</MarkdownContent>
            ) : (
              <p className="text-sm text-muted">
                {messages.editor.previewEmpty}
              </p>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 md:px-6">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex min-h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <p
                aria-live="polite"
                className={cn(
                  'font-mono text-xs',
                  visibleDraftStatus.tone === 'danger'
                    ? 'text-danger'
                    : 'text-muted',
                )}
              >
                {visibleDraftStatus.text}
              </p>
              {shouldRestoreDraft ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={discardDraft}
                  disabled={isPending}
                  className="shrink-0 text-muted"
                >
                  <Trash2 className="h-4 w-4" />
                  {messages.editor.draft.discard}
                </Button>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden font-mono text-xs text-muted md:inline">
                {messages.editor.saveShortcutHint}
              </span>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="h-9 min-w-20 px-4"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>
                  {isPending
                    ? messages.editor.saving
                    : shell.primaryActionLabel}
                </span>
              </Button>
            </div>
          </div>
        </div>
      </form>
    </EntryEditorShell>
  );
}
