import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness for the deploy script and external monitoring. `version` is the
 * commit the image was built from, so a deploy can confirm what is running.
 * No login: it exposes nothing but whether the database answers.
 */
export async function GET() {
  const version = process.env.APP_VERSION ?? 'dev';
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    console.error('healthz: database check failed:', error);
    return NextResponse.json({ ok: false, version }, { status: 503 });
  }
}
