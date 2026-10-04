'use client';

import { useActionState, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { unlock } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { messages } from '@/lib/messages';
import type { ActionResult } from '@/lib/actions/result';

export function getUnlockSubmitLabel(loading: boolean) {
  return loading ? messages.unlock.submitLoading : messages.unlock.submitIdle;
}

export function formatRetryCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function UnlockFields({
  state,
  isPending,
}: {
  state: ActionResult | undefined;
  isPending: boolean;
}) {
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(() =>
    state && !state.ok ? (state.retryAfterSeconds ?? 0) : 0,
  );
  const [revealed, setRevealed] = useState(false);
  const blocked = retryAfterSeconds > 0;

  useEffect(() => {
    if (!blocked) return;
    const timer = window.setInterval(
      () => setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [blocked]);

  const error = blocked
    ? messages.unlock.rateLimited(formatRetryCountdown(retryAfterSeconds))
    : state && !state.ok
      ? state.error
      : undefined;

  return (
    <>
      <div className="relative">
        <label htmlFor="unlock-password" className="sr-only">
          {messages.unlock.password}
        </label>
        <Input
          id="unlock-password"
          name="password"
          type={revealed ? 'text' : 'password'}
          required
          autoComplete="off"
          autoFocus
          disabled={isPending || blocked}
          className="h-11 px-11 text-center font-mono text-base tracking-widest"
          placeholder="PIN"
        />
        {/* Typing a long password blind on a phone means starting over on
            every mistype. */}
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          disabled={isPending || blocked}
          aria-label={
            revealed
              ? messages.unlock.hidePassword
              : messages.unlock.showPassword
          }
          aria-pressed={revealed}
          className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface2 hover:text-text disabled:opacity-50"
        >
          {revealed ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      {error ? (
        <div role="alert" className="text-center font-mono text-xs text-danger">
          {error}
        </div>
      ) : null}
      <Button
        type="submit"
        disabled={isPending || blocked}
        className="h-11 w-full"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {getUnlockSubmitLabel(isPending)}
      </Button>
    </>
  );
}

export default function UnlockPage() {
  const [state, action, isPending] = useActionState(unlock, undefined);
  const retryAfterSeconds =
    state && !state.ok ? (state.retryAfterSeconds ?? 0) : 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <form action={action} className="w-full max-w-xs space-y-4">
        <h1 className="pb-4 text-center font-mono text-2xl font-semibold tracking-tight text-text">
          diary<span className="animate-pulse text-primary">_</span>
        </h1>
        <UnlockFields
          key={retryAfterSeconds}
          state={state}
          isPending={isPending}
        />
      </form>
    </div>
  );
}
