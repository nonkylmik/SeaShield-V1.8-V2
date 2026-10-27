# Self-hosted fonts

IBM Plex Sans and IBM Plex Mono for the whole app. These are the exact Google Fonts files the app previously loaded at runtime from `fonts.gstatic.com`, copied unchanged. `src/styles.css` declares them with `@font-face` rules that match Google's CSS: the same family names, weights, `font-stretch`, unicode ranges and `font-display: swap`. Vite bundles them as same-origin assets, and nothing is fetched from a third party at runtime.

Only the `latin` and `latin-ext` subsets are kept; they cover every character the UI uses. As before, characters outside them, such as → (U+2192), render in the system fallback font named in `--font-sans` / `--font-mono`.

| | |
| --- | --- |
| Fonts | IBM Plex Sans (Google Fonts version v23, variable: weights 400–700 in one file per subset) and IBM Plex Mono (v20, one file per weight) |
| Source CSS | `https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap` (the URL previously linked from `src/routes/__root.tsx`) |
| License | SIL Open Font License 1.1, Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" ([`OFL.txt`](OFL.txt)) |
| License source | https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/OFL.txt (identical to `ofl/ibmplexmono/OFL.txt`), SHA-256 `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
| Retrieved | 2026-10-27 |

| File | Family | Weights | Subset | Bytes | SHA-256 | Source URL |
| --- | --- | --- | --- | --- | --- | --- |
| `ibm-plex-mono-v20-400-latin-ext.woff2` | IBM Plex Mono | 400 | latin-ext | 13,348 | `6bc0f226a5b7884a8170e3f62c63d7675609d4631bdc5931b5cdab81821f00eb` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1iEq129k.woff2 |
| `ibm-plex-mono-v20-400-latin.woff2` | IBM Plex Mono | 400 | latin | 14,708 | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2 |
| `ibm-plex-mono-v20-500-latin-ext.woff2` | IBM Plex Mono | 500 | latin-ext | 13,432 | `6bb06407c97584b0867a959e05e8874693bfeb8c317de190811c51598f2d99ea` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgtIU.woff2 |
| `ibm-plex-mono-v20-500-latin.woff2` | IBM Plex Mono | 500 | latin | 14,888 | `01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2 |
| `ibm-plex-mono-v20-600-latin-ext.woff2` | IBM Plex Mono | 600 | latin-ext | 14,328 | `32057cf50dd14bdb21a2c93766c4a2c43e4abe688ea3922df3203cac7751a98b` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgtIU.woff2 |
| `ibm-plex-mono-v20-600-latin.woff2` | IBM Plex Mono | 600 | latin | 15,620 | `0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2 |
| `ibm-plex-sans-v23-latin-ext.woff2` | IBM Plex Sans | 400–700 (variable) | latin-ext | 30,964 | `d160e20920ae4d6556518d352d3af27a74e9b0de3d8fe17b1c1044fc75aa2f81` | https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbABA.woff2 |
| `ibm-plex-sans-v23-latin.woff2` | IBM Plex Sans | 400–700 (variable) | latin | 45,712 | `e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470` | https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2 |

Total: 163,000 bytes. A typical page loads only the four `latin` files; a `latin-ext` file loads only when a character in its range appears, for example the "ń" in "Gdańsk".

Replacing or adding a font file needs the same record: source URL, version, checksum, license and any changes.
