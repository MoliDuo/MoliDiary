import type { AppDatabase } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/actions/result';
import { eq } from 'drizzle-orm';

export const SETTINGS_OWNER_ID = 'owner';
const THEMES = ['system', 'light', 'dark'] as const;
const EDITOR_FONT_SIZES = ['small', 'medium', 'large'] as const;
const EXPORT_FORMATS = ['markdown', 'json'] as const;

export type Theme = (typeof THEMES)[number];
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type AppSettings = {
  theme: Theme;
  timeZone: string;
  editorFontSize: EditorFontSize;
  defaultExportFormat: ExportFormat;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  timeZone: 'Asia/Shanghai',
  editorFontSize: 'medium',
  defaultExportFormat: 'markdown',
};

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value.length > 0;
  } catch {
    return false;
  }
}

function isMember<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T);
}

export function parseSettingsFormData(formData: FormData): AppSettings | null {
  const theme = String(formData.get('theme') ?? '');
  const timeZone = String(formData.get('timeZone') ?? '').trim();
  const editorFontSize = String(formData.get('editorFontSize') ?? '');
  const defaultExportFormat = String(formData.get('defaultExportFormat') ?? '');

  if (
    !isMember(THEMES, theme) ||
    !isValidTimeZone(timeZone) ||
    !isMember(EDITOR_FONT_SIZES, editorFontSize) ||
    !isMember(EXPORT_FORMATS, defaultExportFormat)
  ) {
    return null;
  }
  return { theme, timeZone, editorFontSize, defaultExportFormat };
}

export async function readSettings(
  database: AppDatabase,
): Promise<AppSettings> {
  const row = await database.query.settings.findFirst({
    where: eq(settings.ownerId, SETTINGS_OWNER_ID),
  });
  if (!row) return DEFAULT_SETTINGS;
  return {
    theme: isMember(THEMES, row.theme) ? row.theme : DEFAULT_SETTINGS.theme,
    timeZone: isValidTimeZone(row.timeZone)
      ? row.timeZone
      : DEFAULT_SETTINGS.timeZone,
    editorFontSize: isMember(EDITOR_FONT_SIZES, row.editorFontSize)
      ? row.editorFontSize
      : DEFAULT_SETTINGS.editorFontSize,
    defaultExportFormat: isMember(EXPORT_FORMATS, row.defaultExportFormat)
      ? row.defaultExportFormat
      : DEFAULT_SETTINGS.defaultExportFormat,
  };
}

type SettingsActionDeps = {
  db: AppDatabase;
  authorize: () => unknown | Promise<unknown>;
  revalidatePath: (path: string) => void;
};

export function createSettingsActions({
  db,
  authorize,
  revalidatePath,
}: SettingsActionDeps) {
  return {
    async saveSettings(
      _previous: ActionResult<AppSettings> | undefined,
      formData: FormData,
    ): Promise<ActionResult<AppSettings>> {
      await authorize();
      const input = parseSettingsFormData(formData);
      if (!input) return { ok: false, error: '设置值无效，请检查后重试' };

      await db
        .insert(settings)
        .values({ ownerId: SETTINGS_OWNER_ID, ...input, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.ownerId,
          set: { ...input, updatedAt: new Date() },
        });
      revalidatePath('/');
      revalidatePath('/settings');
      return { ok: true, data: input };
    },
  };
}
