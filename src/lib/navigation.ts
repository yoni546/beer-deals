/**
 * A real page load (not a client-side transition).
 *
 * Next's client router keeps the root layout mounted across navigations, and the
 * root layout is where the per-user theme is rendered — so after something that
 * changes the user's Primary Beer, only a full load shows the new theme. It lives
 * in its own module so component tests can replace it (jsdom cannot navigate).
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
