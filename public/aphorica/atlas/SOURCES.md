# Aphorica thought globe

Adapted from D3 Hospitality’s Sommni wineLENS `OrbitGlobe`, `globePoint`, `unproject` and `fitCamera` implementation, from the local winelens-beta-20261018 source. The Fibonacci land-dot field and orthographic projection are reused; wine-specific coverage, counts and winery points are excluded.

Geography: Natural Earth, public domain, countries/territories and simplified administrative boundaries. Pinned source URLs and hashes are in provenance.json. Italian provinces are grouped into the 20 parent regions by the Sommni build. Borders are for exploration, not a statement of political recognition.

Country ID mask is copied from Sommni. Countries and administrative regions are split into local JSON files to load state geometry only on selection. There are no map tiles, tracking or location permissions.

Land dots indicate geography, not users. Activity rings show only API-provided broad-region aggregates, at illustrative regional centers, never individual locations or country/state totals. Existing aggregation thresholds remain unchanged.
