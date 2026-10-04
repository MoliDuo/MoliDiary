'use client';

import { useRouter } from 'next/navigation';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { lock } from '@/lib/auth/actions';
import { PendingActionButton } from '@/components/PendingActionButton';
import { messages } from '@/lib/messages';
import { unlockPath } from '@/lib/pathname';

/**
 * Forgets the unlock session, so the master password is asked again. It does
 * not sign out of Authelia. Lives on the settings page rather than the header,
 * where it sat next to 新建 — an easy mis-tap on mobile that costs a password entry.
 */
export function LockButton() {
  const router = useRouter();

  async function handleLock() {
    try {
      const result = await lock();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('已锁定');
      router.replace(unlockPath());
      router.refresh();
    } catch {
      toast.error('锁定失败，请重试');
    }
  }

  return (
    <PendingActionButton
      variant="secondary"
      type="button"
      action={handleLock}
      idleContent={
        <>
          <LogOut className="h-4 w-4" />
          {messages.common.lock}
        </>
      }
      pendingContent={
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {messages.common.lock}
        </>
      }
    />
  );
}
