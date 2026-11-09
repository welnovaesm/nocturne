import { applyTheme, toggleTheme } from '@/utils/theme';

export default defineContentScript({
  // Explicit schemes: in Firefox, `*://` also matches ws/wss.
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    const start = performance.now();
    const readyState = document.readyState;
    const applied = applyTheme();

    const duration = performance.now() - start;
    console.log(
      `[Nocturne] initialized | readyState=${readyState} | themeApplied=${applied} | init=${duration.toFixed(3)}ms | t=${start.toFixed(1)}ms`,
    );

    // Dev-only toggle for manual testing: Alt+Shift+N. Stripped from production builds.
    if (import.meta.env.DEV) {
      ctx.addEventListener(
        window,
        'keydown',
        (event) => {
          if (event.altKey && event.shiftKey && event.code === 'KeyN') {
            console.log(`[Nocturne] theme ${toggleTheme() ? 'applied' : 'removed'}`);
          }
        },
        { capture: true },
      );
    }
  },
});
