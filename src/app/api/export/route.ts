import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { formatDateInTimeZone } from '@/lib/entry-date';
import { formatTimeForFilename } from '@/lib/format';
import {
  createTextStream,
  InvalidExportParametersError,
  jsonExportChunks,
  markdownExportChunks,
  parseExportParameters,
  type ExportEntry,
  type ExportFilters,
} from '@/lib/export-core';
import { getSettings } from '@/lib/settings';
import type { AppSettings } from '@/lib/settings-core';
import { loadExportEntries } from '@/lib/export-data';

type ExportRouteDeps = {
  authorize: () => unknown | Promise<unknown>;
  loadSettings: () => AppSettings | Promise<AppSettings>;
  loadEntries: (filters: ExportFilters) => Promise<ExportEntry[]>;
  now?: () => Date;
  reportError?: (error: unknown) => void;
};

type ExportFailure = 'invalid' | 'error' | 'empty';

const FAILURE_STATUS: Record<ExportFailure, number> = {
  invalid: 400,
  empty: 404,
  error: 500,
};

/**
 * A browser without JavaScript posts the native form and needs a redirect it
 * can follow. The enhanced client asks for JSON so it can report the problem
 * in place, leaving the date range and tag selection exactly as chosen —
 * previously every failure sent you back to an empty form.
 */
function wantsJson(request: Request) {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

function failure(request: Request, status: ExportFailure) {
  if (wantsJson(request)) {
    return Response.json(
      { error: status },
      {
        status: FAILURE_STATUS[status],
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
  return Response.redirect(
    new URL(`/settings?export=${status}`, request.url),
    303,
  );
}

export function createExportRouteHandler({
  authorize,
  loadSettings,
  loadEntries,
  now = () => new Date(),
  reportError = (error) => console.error('Export failed:', error),
}: ExportRouteDeps) {
  return async function GET(request: Request) {
    if (!(await authorize())) {
      if (wantsJson(request)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return Response.redirect(new URL('/unlock', request.url), 303);
    }

    let filters: ExportFilters;
    try {
      filters = parseExportParameters(new URL(request.url).searchParams);
    } catch (error) {
      if (error instanceof InvalidExportParametersError)
        return failure(request, 'invalid');
      reportError(error);
      return failure(request, 'error');
    }

    try {
      const [rows, settings] = await Promise.all([
        loadEntries(filters),
        loadSettings(),
      ]);
      if (rows.length === 0) return failure(request, 'empty');

      const exportedAt = now();
      const chunks =
        filters.format === 'markdown'
          ? markdownExportChunks(rows, filters, exportedAt)
          : jsonExportChunks(rows, filters, exportedAt);
      const extension = filters.format === 'markdown' ? 'md' : 'json';
      const contentType =
        filters.format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8';
      // Includes the time: two exports on the same day used to overwrite.
      const stamp = `${formatDateInTimeZone(exportedAt, settings.timeZone)}-${formatTimeForFilename(exportedAt, settings.timeZone)}`;
      const filename = `diary-export-${stamp}.${extension}`;

      return new Response(createTextStream(chunks), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      reportError(error);
      return failure(request, 'error');
    }
  };
}

const GET = createExportRouteHandler({
  authorize: getSession,
  loadSettings: getSettings,
  loadEntries: (filters) => loadExportEntries(db, filters),
});

export { GET };
