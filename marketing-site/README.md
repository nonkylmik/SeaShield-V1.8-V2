# SeaShield marketing site

A standalone landing page for SeaShield, to recruit maritime organisations for prototype demonstrations
and early-access testing. It is separate from the SeaShield application: it shares no code, build,
dependencies or runtime with it, and nothing outside this directory depends on it.

- **Stack:** static HTML, CSS and vanilla JavaScript ES modules. No framework, no dependencies, no build step.
- **Status:** not published. No domain, hosting, form destination or analytics is configured.

## Run and test

Requires Node 22.12 or later. From this directory:

```sh
npm run serve   # http://127.0.0.1:5180/ (set MARKETING_PORT to change the port)
npm test        # node:test: form logic, page integrity, contrast, preview-server path safety
```

The preview server binds to `127.0.0.1` only and serves just the site's own files. It is for local
preview, not production hosting. Any static host can serve the site as-is.

The repository's root `npm run lint` also checks the JavaScript files here (Prettier formatting).
The root type-check, build and app tests do not include this directory.

## Files

| Path                | Purpose                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `index.html`        | The landing page                                                                           |
| `privacy.html`      | Privacy notice, **draft** (`noindex`), to be completed before launch                       |
| `styles.css`        | All styles; palette tokens are CSS variables in `:root`                                    |
| `main.js`           | Mobile navigation and form wiring                                                          |
| `form.js`           | Form validation and submission logic (no DOM; tested directly)                             |
| `config.js`         | `FORM_ENDPOINT`: `null` means the form is not connected                                    |
| `favicon.svg`       | Text-mark icon                                                                             |
| `assets/fonts/`     | IBM Plex Sans and Mono, copied unchanged from `src/assets/fonts/` (SIL OFL 1.1, `OFL.txt`) |
| `assets/screens/`   | Product screenshots (see below)                                                            |
| `scripts/serve.mjs` | Dependency-free local preview server                                                       |
| `tests/`            | `node:test` suites                                                                         |

## The early-access form is not connected

`config.js` sets `FORM_ENDPOINT = null`. In that state the form checks entries in the browser, then
tells the visitor that nothing was sent or stored. It never sends, stores or reports success.

The form's controls, including the submit button, ship inside a disabled `<fieldset>`. `main.js`
enables it only after the submit handler is attached. Without JavaScript (disabled, blocked, or failing
to load) the form cannot be filled in or submitted, so the browser's native form submission can never
send anything.

To connect it later, after a destination has been approved:

1. Set `FORM_ENDPOINT` in `config.js`.
2. Add the endpoint's origin to `connect-src` in the Content-Security-Policy in `index.html`.
3. Complete `privacy.html` for that destination (processor, location, retention) and have it reviewed.

`submitLead` reports success only on a 2xx response. A filled honeypot field (`website`) is never sent.

## Product screenshots

The images in `assets/screens/` are genuine captures of the SeaShield prototype, taken on 2026-10-28
from the app at `/map` with headless Chrome:

- `map-1600.webp`, `map-800.webp`: the tactical map with a vessel selected (1600×1000 and 800×500).
- `context-panel.webp`: the selected-vessel context panel (335×528 CSS pixels at 2×).

The app's backend ran against a throwaway scratch SQLite database, because the map's positions come only
from the backend. The repository's `backend/seashield.db` was not used. All vessels, positions and routes
are the app's fictional demo data. Each image is shown with a simulated-data disclosure in its caption.

## Content rules

- Label prototype features as available on simulated data; label integrations (AIS, CCTV, sensors,
  access control, cyber feeds) as planned.
- No live-data, AI, certification, customer or performance claims. `tests/site.test.mjs` checks for the
  most likely ones.

## Owner-supplied information still needed

Shown on the pages as highlighted `[… to be supplied]` placeholders:

- Contact email (footer, privacy notice).
- Legal name, address and country of the operating entity (privacy notice).
- Legal basis, recipients, retention period and applicable rights (privacy notice, after advice).
- The public domain. Canonical and social-sharing URLs are deliberately left out until it is known.
