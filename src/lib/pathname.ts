export function dashboardPath() {
  return '/';
}

/** Starts the Authelia sign-in; there is no page of ours behind it. */
export function loginPath() {
  return '/auth/login';
}

export function unlockPath() {
  return '/unlock';
}

export function entryDetailPath(id: string) {
  return `/entries/${id}`;
}

export function entryEditPath(id: string) {
  return `/entries/${id}/edit`;
}

export function newEntryPath() {
  return '/entries/new';
}

export function settingsPath() {
  return '/settings';
}

export function trashPath() {
  return '/settings/trash';
}

export function stripLegacyLocalePath(pathname: string) {
  if (pathname === '/zh' || pathname === '/en') return '/';
  if (pathname.startsWith('/zh/')) return pathname.slice(3);
  if (pathname.startsWith('/en/')) return pathname.slice(3);
  return pathname;
}
