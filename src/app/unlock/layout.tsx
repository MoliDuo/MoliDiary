import type { Metadata } from 'next';

// The unlock page is a client component and cannot export metadata itself.
export const metadata: Metadata = { title: '解锁' };

export default function UnlockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
