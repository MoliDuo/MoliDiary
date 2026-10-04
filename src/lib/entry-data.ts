import { cache } from 'react';
import { findActiveEntry } from '@/lib/db/entries-repo';

/**
 * Cached per request so a page and its generateMetadata can both read the
 * entry without issuing two queries. Trashed entries read as missing.
 */
export const getEntryById = cache((id: string) => findActiveEntry(id));
