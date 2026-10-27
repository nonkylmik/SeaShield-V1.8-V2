# Bundled map data

`ne_110m_land.geojson` is the land layer of the tactical map (`/map`). It ships with the frontend and is loaded from the app's own origin only when the map opens; nothing is downloaded from a third party at runtime.

| | |
| --- | --- |
| Dataset | Natural Earth 1:110m Physical Vectors, Land (`ne_110m_land`) |
| Version | 5.1.2 |
| Source | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson |
| Source SHA-256 | `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9` (138,160 bytes) |
| License | Public domain ([Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/)); no attribution required |
| Retrieved | 2026-10-27 |

## Changes from the source

The file was reduced for size; the geometry is otherwise unchanged:

1. Feature properties (`featurecla`, `scalerank`, `min_zoom`) removed.
2. Coordinates rounded to 2 decimal places (about 1 km, well below one pixel at the map's zoom range).
3. Consecutive duplicate points created by rounding removed; every ring stays closed with at least 4 points.

All 127 polygons are kept. The result is 86,526 bytes (27,628 bytes gzipped).

Replacing this file needs the same record: dataset, version, source, checksum, license and any changes.
