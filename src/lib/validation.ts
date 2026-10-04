export const ENTRY_CONTENT_MAX_LENGTH = 200_000;
export const SEARCH_QUERY_MAX_LENGTH = 200;
const BULK_ENTRY_MAX_COUNT = 100;

export type EntryInput = {
  content: string;
  createdAt: Date;
};

export class InputValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'too_large' = 'invalid',
  ) {
    super(message);
    this.name = 'InputValidationError';
  }
}

export function parseEntryDate(value: unknown, now = new Date()): Date {
  if (value === null || value === undefined || value === '') {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputValidationError('日期格式必须为 YYYY-MM-DD');
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new InputValidationError('日期无效');
  }
  return parsed;
}

export function parseEntryContent(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InputValidationError('内容不能为空');
  }
  if (value.length > ENTRY_CONTENT_MAX_LENGTH) {
    throw new InputValidationError(
      `内容不能超过 ${ENTRY_CONTENT_MAX_LENGTH} 字`,
      'too_large',
    );
  }
  return value;
}

export function parseEntryInput(
  content: unknown,
  createdAt: unknown,
): EntryInput {
  return {
    content: parseEntryContent(content),
    createdAt: parseEntryDate(createdAt),
  };
}

export function normalizeSearchQuery(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputValidationError('搜索词无效');
  const query = value.trim();
  if (!query) return undefined;
  if (query.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new InputValidationError(
      `搜索词不能超过 ${SEARCH_QUERY_MAX_LENGTH} 字`,
    );
  }
  return query;
}

export function normalizeTagFilter(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputValidationError('标签无效');
  const tag = value.trim();
  if (!tag) return undefined;
  if (tag.length > 50) throw new InputValidationError('标签最多 50 字');
  return tag;
}

export function normalizeEntryIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new InputValidationError('条目 ID 列表无效');
  const ids = Array.from(
    new Set(
      value.filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && id.length <= 64,
      ),
    ),
  );
  if (ids.length > BULK_ENTRY_MAX_COUNT) {
    throw new InputValidationError(
      `一次最多处理 ${BULK_ENTRY_MAX_COUNT} 条记录`,
    );
  }
  return ids;
}
