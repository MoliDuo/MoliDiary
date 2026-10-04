import { normalizeTags } from '@/lib/tags';
import type { ExportFormat } from '@/lib/settings-core';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ExportFilters = {
  format: ExportFormat;
  from?: string;
  to?: string;
  tags: string[];
};

export type ExportEntry = {
  id: string;
  content: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  source: string | null;
  aiStatus: string | null;
  createdAt: Date;
  recordedAt: Date;
  updatedAt: Date | null;
};

export class InvalidExportParametersError extends Error {}

function isCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function parseExportParameters(params: URLSearchParams): ExportFilters {
  const format = params.get('format');
  const from = params.get('from')?.trim() || undefined;
  const to = params.get('to')?.trim() || undefined;
  const rawTags = params.getAll('tags');
  if (
    (format !== 'markdown' && format !== 'json') ||
    (from !== undefined && !isCalendarDate(from)) ||
    (to !== undefined && !isCalendarDate(to)) ||
    (from !== undefined && to !== undefined && from > to) ||
    rawTags.length > 10 ||
    rawTags.some((tag) => !tag.trim() || tag.trim().length > 50)
  ) {
    throw new InvalidExportParametersError('Invalid export parameters');
  }
  const tags = normalizeTags(rawTags);
  return { format, from, to, tags };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function yamlString(value: string | null) {
  return JSON.stringify(value ?? '');
}

function markdownHeader(
  entryCount: number,
  filters: ExportFilters,
  exportedAt: Date,
) {
  return [
    '# Moli Diary 日记导出',
    '',
    `生成时间：${exportedAt.toISOString()}`,
    `条目数：${entryCount}`,
    `日期范围：${filters.from ?? '不限'} 至 ${filters.to ?? '不限'}`,
    `标签：${filters.tags.length > 0 ? filters.tags.join('、') : '不限'}`,
  ].join('\n');
}

function markdownEntry(entry: ExportEntry) {
  const title = entry.title?.trim() || '未命名记录';
  const tags = entry.tags;
  return [
    '---',
    `id: ${yamlString(entry.id)}`,
    `title: ${yamlString(title)}`,
    `date: ${yamlString(dateOnly(entry.createdAt))}`,
    `tags: ${JSON.stringify(tags)}`,
    `summary: ${yamlString(entry.summary)}`,
    '---',
    '',
    `## ${title}`,
    '',
    `_${dateOnly(entry.createdAt)}_`,
    '',
    entry.content,
  ].join('\n');
}

export function* markdownExportChunks(
  entries: ExportEntry[],
  filters: ExportFilters,
  exportedAt: Date,
) {
  yield markdownHeader(entries.length, filters, exportedAt);
  for (const entry of entries) yield `\n\n${markdownEntry(entry)}`;
  yield '\n';
}

function jsonEntry(entry: ExportEntry) {
  return {
    id: entry.id,
    content: entry.content,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    source: entry.source,
    aiStatus: entry.aiStatus,
    createdAt: dateOnly(entry.createdAt),
    recordedAt: entry.recordedAt.toISOString(),
    updatedAt: entry.updatedAt?.toISOString() ?? null,
  };
}

export function* jsonExportChunks(
  entries: ExportEntry[],
  filters: ExportFilters,
  exportedAt: Date,
) {
  yield `{"schemaVersion":2,"exportedAt":${JSON.stringify(exportedAt.toISOString())},"filters":${JSON.stringify({ from: filters.from ?? null, to: filters.to ?? null, tags: filters.tags })},"entries":[`;
  for (let index = 0; index < entries.length; index += 1) {
    yield `${index === 0 ? '' : ','}${JSON.stringify(jsonEntry(entries[index]))}`;
  }
  yield ']}\n';
}

export function createTextStream(chunks: Iterable<string>) {
  const iterator = chunks[Symbol.iterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
}
