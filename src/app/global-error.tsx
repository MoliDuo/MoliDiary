'use client';

import './moli-tokens.css';

// global-error replaces the root layout, so globals.css is not loaded here and
// Tailwind classes would not apply. Inline styles on the design tokens alone keep
// this readable even when the failure is in the stylesheet or the layout itself.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body
        data-app="diary"
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'var(--moli-font-sans)',
          background: 'var(--moli-bg)',
          color: 'var(--moli-text)',
        }}
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--moli-muted)' }}>
          页面出错了，请重试
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            height: '2.5rem',
            padding: '0 1rem',
            borderRadius: 'var(--moli-radius-sm)',
            border: 'none',
            cursor: 'pointer',
            background: 'var(--moli-accent)',
            color: 'var(--moli-accent-fg)',
            fontSize: '0.875rem',
          }}
        >
          重试
        </button>
      </body>
    </html>
  );
}
