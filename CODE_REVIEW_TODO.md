# Code Review Todo List

Generated from a full read-through of the codebase (client `src/`, dev-server
middleware `vite.config.js` / `server/pathUtils.js`, and Docker/build config)
on 2026-09-05. Intended for another agent to pick up and fix items one at a
time. **Do not add or modify tests as part of this list** — the `tests/`
folder is intentionally out of scope.

Overall the codebase is in good shape: path traversal, XSS (via
`escapeHtml`), CSRF (`isTrustedOrigin`), and request-size limits are already
handled thoughtfully in the dev-server middleware, and `catalogPalette.js`
consistently escapes untrusted strings before `innerHTML` use. The items
below are the remaining gaps, bugs, and cleanup opportunities.

---

## 1. Bugs

- [x] **`PlacementSystem.destroy()` is incomplete and never called.**
  [src/placement.js](src/placement.js) `_setupEvents()` registers five
  listeners on `#viewport`/`window`: `pointerdown` (`_onPointerDown`),
  `pointermove` (`_onPointerMove`), `pointerup` (`_onPointerUp`),
  `contextmenu` (`_onContextMenu`), `keydown` on `window`
  (`_onKeyDown`), **plus a second anonymous `pointerdown` listener** used to
  close the context menu. `destroy()` only removes `pointerdown`,
  `pointermove`, `contextmenu`, and `keydown` — it never removes `pointerup`,
  and the anonymous `pointerdown` listener has no reference to remove at all.
  Either store the anonymous handler so it can be unregistered, or fold its
  logic into `_onPointerDown`. Also confirm `destroy()` is actually invoked
  somewhere (currently `grep` finds zero call sites) — if the app never
  tears down a `PlacementSystem` instance, this is dead code; if multi-file /
  multi-instance support is ever added, this leak will matter.

## 2. Configuration / Security Hardening

- [x] **`docker-compose.yml` doesn't expose the catalog env vars.** Add
  `OPENFORGE_CATALOG_API_URL` / `OPENFORGE_CATALOG_OBJECTS_URL` (with
  sensible defaults or `.env` support) to the `environment:` block so
  Compose users aren't silently stuck on the vite.config.js hardcoded
  fallback. Also clean up the docker file and remove any folder path mappings
  that are not used.

- [ ] **No `Content-Security-Policy` `frame-ancestors`/`X-Frame-Options`.**
  [index.html](index.html) sets a solid CSP via `<meta>` but that tag
  cannot enforce `frame-ancestors` (must be a real HTTP header). If this
  app is ever hosted somewhere embeddable, add `X-Frame-Options: DENY` (or
  `frame-ancestors 'none'`) as a real response header from the dev server /
  reverse proxy in front of it.

## 3. Error Handling / UX

- [ ] **Silent failures with no user feedback.** Many `catch` blocks across
  [src/placement.js](src/placement.js) (`_paste()`, `_loadFromData()`),
  [src/templates.js](src/templates.js) (`resolveTemplateTiles()`), and
  [src/downloadedModels.js](src/downloadedModels.js) only `console.warn`/
  `console.error` on failure (e.g. a model fails to load STL geometry, a
  paste fails, a template tile can't resolve). The user sees nothing
  missing tiles/pastes with no indication why. Consider surfacing a
  non-blocking toast/notification for at least the "N of M tiles failed to
  load" case.

- [ ] **`main.js` load-layout error handling**: `loadItem` click handler
  catches `JSON.parse`/`importLayout` failures and only logs to console —
  the user gets no indication their "Load Layout" action failed. Add a
  visible error message.

- [ ] **`localStorage` quota exceeded** ([src/storage.js](src/storage.js))
  is warned once via `console.warn` and then silently ignored forever after
  (`warnedKeys` dedup). Since this can mean layout autosave silently stops
  working, surface this to the user (e.g. a persistent banner) rather than
  a one-time console message that most users will never see.

## 4. Accessibility

- [ ] **Dropdown menus (`#file-menu`, `#templates-menu`, `#settings-menu`,
  `#new-file-menu`, `#context-menu`) have no keyboard navigation or focus
  management.** Opening a menu via mouse click doesn't move focus into it,
  `Escape` doesn't consistently close all of them (only some paths call
  `closeAllMenus()`), and there's no focus trap or return-focus-on-close
  behavior. This makes the toolbar unusable via keyboard/screen reader.

## 5. Performance / Memory

- [ ] **Per-render network `HEAD` probes.** In
  [src/downloadedModels.js](src/downloadedModels.js),
  `ensureCatalogThumbCached()` fires a `HEAD` request the first time each
  thumbnail URL is seen in a session (deduped via `catalogThumbSeen`, so
  it's not literally per-render, but every distinct catalog thumbnail
  triggers a network round trip before the cached copy is confirmed).
  Consider batching these or caching the "confirmed cached" result in
  `localStorage`/IndexedDB so repeat sessions skip the HEAD entirely.

- [ ] **`_outlineGeoCache` and material caches in
  [src/modelLoader.js](src/modelLoader.js) are keyed by rounded bounding-box
  size / color+roughness+metalness strings** — reasonable, but there's no
  eviction tied to actual usage the way `pruneGeometries()` handles
  geometries; only a raw size cap (`200` entries, oldest-first). Confirm
  this cap is generous enough for real catalogs (hundreds of distinct tile
  footprints) or make it configurable.

- [ ] **`getTileFootprintMm`/`isBaseTile`/etc. in
  [src/modelCatalog.js](src/modelCatalog.js) call `getOverride(modelInfo.fileName)`
  on every invocation**, and these are called in hot paths
  (`_checkCollision`, `_findStackTop`, `_findBaseAt`) that run on every
  pointer-move frame for every placed mesh — i.e. O(placed meshes) object
  lookups per animation frame while placing/dragging. For layouts with
  hundreds of tiles this could become a per-frame bottleneck. Consider
  memoizing effective tile footprint/type on the mesh's `userData` when the
  mesh is created/overridden, instead of recomputing from tags + override
  lookup every frame.

## 6. Code Quality / Maintainability

- [ ] **Duplicated material-creation logic** between `createMesh()` and
  `recolorMesh()` in [src/modelLoader.js](src/modelLoader.js) (identical
  cache-key computation + `MeshStandardMaterial` construction block
  repeated verbatim). Extract a shared `_getOrCreateMaterial(color)` helper.

- [ ] **Duplicated ground-intersection math**: `_getGroundIntersect()` and
  `_getGroundIntersectAt()` in [src/placement.js](src/placement.js) are
  nearly identical (the only difference is which point is used to set up
  the raycaster). Factor out the shared ray/plane math into one function
  parameterized by the screen point.

- [ ] **Inconsistent empty-catch style**: most of the codebase uses
  `catch (e) { /* best effort */ }` or similar comments, but a few spots
  (e.g. `_paste()` in [src/placement.js](src/placement.js)) use
  `console.warn` while sibling code paths silently swallow. Standardize on
  always logging at least a `console.warn` in empty catches so failures are
  discoverable in the browser console during development.

## 7. Verify / Double-Check (not necessarily bugs)

- [ ] **Dependency versions in [package.json](package.json)** —
  `eslint": "^10.10.0"`, `@eslint/js": "^10.0.1"`, `vite": "^8.2.2"` are
  unusually high major versions. Confirm these resolve to real, intended
  releases (run `npm install` / `npm outdated` and check for typos or
  unintended pre-release tags) rather than being a documentation/version
  bump mistake.

- [ ] **`models/` and `public/` directories** are present in the repo root
  but weren't part of this review (out of scope of `src/`/`server/`).
  Confirm nothing sensitive (private keys, local absolute paths, etc.) is
  committed there, since `.gitignore`/`.dockerignore` weren't fully audited
  as part of this pass.
