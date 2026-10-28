/**
 * Where early-access requests are sent. null means the form is not connected: it validates input but sends
 * and stores nothing, and says so. Set this only after a destination has been approved, and add its origin to
 * the Content-Security-Policy `connect-src` in index.html.
 */
export const FORM_ENDPOINT = null;
