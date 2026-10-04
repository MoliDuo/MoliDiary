import { db } from '@/lib/db';
import { createCallbackHandler } from '@/lib/auth/login-flow';

export const GET = createCallbackHandler({ db });
