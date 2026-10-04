export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // The build imports modules to collect page data; it must not touch the
  // database or start timers.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startBackgroundTasks } = await import('@/lib/background-tasks');
  startBackgroundTasks();
}
