// Apply the saved preference before rendering to avoid a flash of the wrong theme.
(() => {
  let theme;
  try {
    theme = localStorage.getItem('devdeck-theme');
  } catch { /* Storage may be unavailable in private browsing. */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
})();
