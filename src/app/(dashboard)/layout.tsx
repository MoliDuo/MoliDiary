import Link from 'next/link';
import { Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';
import {
  dashboardPath,
  loginPath,
  newEntryPath,
  settingsPath,
} from '@/lib/pathname';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
  navControls,
}: {
  children: React.ReactNode;
  navControls: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect(loginPath());
  return (
    // The theme lives on <html> (src/app/layout.tsx) so it also covers /login,
    // the document background and toasts.
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-3 md:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:flex">
            <Link
              href={dashboardPath()}
              className="group flex h-10 shrink-0 items-center font-mono text-[15px] font-semibold tracking-tight text-text"
            >
              <span>diary</span>
              <span className="text-primary transition-opacity group-hover:opacity-0">
                _
              </span>
            </Link>

            {navControls ? (
              <div className="order-3 col-span-2 min-w-0 md:order-none md:flex md:flex-1 md:justify-end">
                {navControls}
              </div>
            ) : (
              <div className="hidden min-w-0 flex-1 md:block" />
            )}

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="text-muted hover:text-text"
              >
                <Link href={settingsPath()} aria-label="设置" title="设置">
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" className="h-9 px-3">
                <Link href={newEntryPath()}>
                  <Plus className="h-4 w-4" />
                  <span>{messages.common.new}</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
