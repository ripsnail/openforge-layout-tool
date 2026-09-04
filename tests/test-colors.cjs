#!/usr/bin/env node
// Tests for the theme colour picker / resolver.
// Verifies that model colours are derived from texture tags (not file names),
// with version > set priority and an explicit importance ordering.

const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'src');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertColor(actual, expected, msg) {
  const got = actual !== undefined ? actual.toString(16).padStart(6, '0') : String(actual);
  assert((actual | 0) === (expected | 0), `${msg} (expected 0x${expected.toString(16).padStart(6, '0')}, got 0x${got})`);
}

async function main() {
  const modelCatalog = await import(pathToFileURL(path.join(SRC, 'modelCatalog.js')).href);
  const catalogApi = await import(pathToFileURL(path.join(SRC, 'catalogApi.js')).href);

  const { resolveTextureColor, getThemeColor, setTextureOverride, getTextureOverride, deriveTextureTags, getEffectiveTextureTags, parseModelFilename, formatTextureTag } = modelCatalog;
  const { parseCatalogTags } = catalogApi;

  const SET = (name) => ({ name, isVersion: false });
  const VER = (name) => ({ name, isVersion: true });

  console.log('Colour / texture-tag tracker tests\n');

  console.log('--- Single texture sets ---');
  assertColor(resolveTextureColor([SET('dungeon_stone')], 'dungeon_stone'), 0x8a8a98, 'dungeon_stone');
  assertColor(resolveTextureColor([SET('cut-stone')], 'cut-stone'), 0x9a9a8a, 'cut-stone');
  assertColor(resolveTextureColor([SET('towne')], 'towne'), 0xc4b99a, 'towne');
  assertColor(resolveTextureColor([SET('wood')], 'wood'), 0x6b4b2b, 'wood');
  assertColor(resolveTextureColor([SET('shingles')], 'shingles'), 0xb05a3c, 'shingles');
  assertColor(resolveTextureColor([SET('stucco')], 'stucco'), 0xd4c4a8, 'stucco');

  console.log('--- Version (texture tag `towne%wood`) overrides set `towne` ---');
  assertColor(
    resolveTextureColor([VER('wood'), SET('towne')], 'towne%wood'),
    0x8b6b4b,
    'towne%wood should use wood version colour'
  );

  console.log('--- Multi-set ordering: gable shingles,stucco should be shingles ---');
  // Regression: shingles,stucco#gable.4x.openlock.stl previously hardcoded to
  // the shingles colour (0xb05a3c); the tag-based resolver must reproduce it.
  assertColor(
    resolveTextureColor([SET('shingles'), SET('stucco')], 'shingles+stucco'),
    0xb05a3c,
    'shingles+stucco should resolve to shingles colour'
  );

  console.log('--- shingles+stucco beats other lower-priority combos ---');
  assertColor(
    resolveTextureColor([SET('shingles'), SET('towne')], 'shingles+towne'),
    0xb05a3c,
    'shingles+towne should resolve to shingles colour'
  );

  console.log('--- Context-menu texture override beats other tags ---');
  // A gable with shingles+stucco tags can have a user-assigned override tag
  // that wins regardless of the source tags.
  const overridden = resolveTextureColor(
    [SET('shingles'), SET('stucco'), { name: 'wood', isVersion: false, override: true }],
    'shingles+stucco'
  );
  assertColor(overridden, 0x6b4b2b, 'override wood should beat shingles+stucco');

  assertColor(
    resolveTextureColor([VER('wood'), SET('towne'), { name: 'dungeon_stone', isVersion: false, override: true }], 'towne%wood'),
    0x8a8a98,
    'override dungeon_stone should beat towne%wood version'
  );

  console.log('--- setTextureOverride / getTextureOverride helpers ---');
  const base = [SET('shingles'), SET('stucco')];
  const withOverride = setTextureOverride(base, 'wood');
  assert(getTextureOverride(withOverride) === 'wood', 'getTextureOverride returns wood');
  assert(withOverride.filter(t => t.override).length === 1, 'only one override tag present');
  assertColor(resolveTextureColor(withOverride, 'shingles+stucco'), 0x6b4b2b, 'override wood color applied');
  assert(getTextureOverride(setTextureOverride(withOverride, null)) === null, 'clearing override returns null');

  console.log('--- Unknown textures fall back to theme / hash (no crash) ---');
  const unk = resolveTextureColor([SET('mystery_mat')], 'mystery_mat');
  assert(typeof unk === 'number' && !isNaN(unk), `unknown texture returned a number, got ${unk}`);

  console.log('--- No texture tags -> theme fallback via getThemeColor ---');
  assertColor(resolveTextureColor(null, 'dungeon_stone'), getThemeColor('dungeon_stone'), 'null tags falls back to theme');

  console.log('--- Integration: parseCatalogTags for the gable model ---');
  const gable = parseCatalogTags(
    ['shape|wall', 'build|thick wall', 'texture|shingles', 'texture|stucco', 'connection|openforge'],
    { file_name: 'shingles,stucco#gable.4x.openlock.stl' }
  );
  assertColor(gable.color, 0xb05a3c, 'gable model colour should be shingles (0xb05a3c)');
  assert(gable.theme === 'shingles+stucco', `gable theme expected shingles+stucco, got ${gable.theme}`);
  assert(
    gable.textureTags.length === 2 &&
    gable.textureTags.some(t => t.name === 'shingles' && !t.isVersion) &&
    gable.textureTags.some(t => t.name === 'stucco' && !t.isVersion),
    'gable textureTags should capture shingles and stucco as sets'
  );

  console.log('--- Derive tags from raw texture| tags (legacy manifest entries) ---');
  const raw = ['component|gable', 'connection|openlock', 'set|roofs', 'texture|shingles', 'texture|stucco'];
  const derived = deriveTextureTags(raw);
  assert(
    derived.length === 2 &&
    derived.some(t => t.name === 'shingles' && !t.isVersion) &&
    derived.some(t => t.name === 'stucco' && !t.isVersion),
    'deriveTextureTags captures shingles and stucco as sets'
  );
  assert(deriveTextureTags(null).length === 0, 'deriveTextureTags handles null');
  assert(deriveTextureTags(['texture|plain']).length === 0, 'plain texture is ignored');

  const rawVer = ['texture|towne', 'texture|towne|broken_stucco-a'];
  const derivedVer = deriveTextureTags(rawVer);
  assert(
    derivedVer.some(t => t.name === 'towne' && !t.isVersion) &&
    derivedVer.some(t => t.name === 'broken_stucco-a' && t.isVersion),
    'deriveTextureTags captures towne set + broken_stucco-a version'
  );

  console.log('--- getEffectiveTextureTags prefers stored tags, falls back to raw ---');
  assert(
    getEffectiveTextureTags({ textureTags: [{ name: 'wood', isVersion: false }], tags: ['texture|shingles'] }).length === 1 &&
    getEffectiveTextureTags({ textureTags: [{ name: 'wood', isVersion: false }] })[0].name === 'wood',
    'stored textureTags are preferred'
  );
  assert(
    getEffectiveTextureTags({ tags: raw }).length === 2,
    'falls back to deriving from raw tags when textureTags is missing'
  );
  assert(getEffectiveTextureTags({}) === null, 'no tags yields null');
  assert(
    resolveTextureColor(getEffectiveTextureTags({ tags: raw }), 'shingles+stucco') === 0xb05a3c,
    'color resolves from raw tags fallback'
  );

  console.log('--- Regression: gable fallback (parseModelFilename) carries texture tags ---');
  // shingles,stucco#gable.4x.openlock.stl restored via the filename fallback
  // (manifest miss) previously had no tags at all, so the menu showed nothing.
  const gableFallback = parseModelFilename('shingles,stucco#gable.4x.openlock.stl');
  assert(
    Array.isArray(gableFallback.textureTags) &&
    gableFallback.textureTags.some(t => t.name === 'shingles' && !t.isVersion) &&
    gableFallback.textureTags.some(t => t.name === 'stucco' && !t.isVersion),
    'parseModelFilename derives shingles+stucco textureTags from the filename prefix'
  );
  assertColor(
    resolveTextureColor(getEffectiveTextureTags(gableFallback), gableFallback.theme),
    0xb05a3c,
    'fallback gable resolves to shingles colour'
  );

  console.log('--- Regression: legacy DB-shaped entry (theme stucco, raw tags) heals ---');
  // Mirrors the stale metadata.sqlite row: legacy theme, no textureTags.
  const legacyGable = {
    theme: 'stucco',
    tags: ['component|gable', 'connection|openlock', 'set|roofs', 'size|width|4', 'texture|shingles', 'texture|stucco'],
  };
  const healedTags = getEffectiveTextureTags(legacyGable);
  assert(healedTags && healedTags.length === 2, 'legacy entry derives 2 texture tags from raw tags');
  assertColor(
    resolveTextureColor(healedTags, legacyGable.theme),
    0xb05a3c,
    'legacy gable entry resolves to shingles colour'
  );

  console.log('--- Full tag strings are carried and formatted ---');
  const fullDerived = deriveTextureTags(['texture|towne', 'texture|towne|broken_stucco-a']);
  assert(
    fullDerived.some(t => t.tag === 'texture|towne|broken_stucco-a' && t.isVersion) &&
    fullDerived.some(t => t.tag === 'texture|towne' && !t.isVersion),
    'deriveTextureTags keeps the full tag string'
  );
  assert(
    formatTextureTag({ name: 'broken_stucco-a', isVersion: true, tag: 'texture|towne|broken_stucco-a' }) === 'texture|towne|broken_stucco-a',
    '3-part tag formats as the full tag'
  );
  assert(
    formatTextureTag({ name: 'shingles', isVersion: false, tag: 'texture|shingles' }) === 'texture|shingles',
    '2-part tag formats as the full tag'
  );
  assert(
    formatTextureTag({ name: 'wood', isVersion: false }) === 'texture|wood',
    'missing tag field falls back to texture|name'
  );
  assert(
    formatTextureTag({ name: 'mystery', isVersion: true }) === 'texture|mystery (version)',
    'version without a full tag keeps the (version) mark'
  );
  assert(
    formatTextureTag({ name: 'wood', isVersion: false, override: true, tag: 'texture|wood' }) === 'texture|wood (override)',
    'override tag is marked'
  );
  const ovFull = setTextureOverride([], 'wood');
  assert(ovFull[0].tag === 'texture|wood', 'setTextureOverride carries the full tag');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
