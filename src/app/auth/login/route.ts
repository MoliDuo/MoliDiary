import { db } from '@/lib/db';
import { createLoginHandler } from '@/lib/auth/login-flow';

export const GET = createLoginHandler({ db });
