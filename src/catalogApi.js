import {
  generateModelId,
  resolveTextureColor,
  getThemeInfo,
} from "./modelCatalog.js";

const API_BASE = "/catalog-api";

// fetch() with a hard timeout: hung requests (stalled proxy, dead CDN)
// reject instead of hanging the UI forever.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const { signal: externalSignal, ...restOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  try {
    return await fetch(url, { ...restOptions, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") {
      if (externalSignal?.aborted) throw e;
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`, {
        cause: e,
      });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

const getCatalogThemeInfo = getThemeInfo;

// --- parseCatalogTags() helpers -------------------------------------------
// Each helper parses one unrelated category of OpenForge catalog tags out of
// the flat `tags` array. Split out of parseCatalogTags() so each concern can
// be read/tested in isolation.

function parsePrimaryType(tagSet) {
  if (tagSet.has("shape|floor")) return "floor";
  if (tagSet.has("shape|base")) return "base";
  if (tagSet.has("shape|wall")) return "wall";
  if (tagSet.has("shape|column")) return "column";
  if (tagSet.has("shape|corner")) return "corner";
  return "other";
}

function parseTypeTags(tagSet, primaryType) {
  const typeTags = [];
  if (primaryType !== "other") typeTags.push(primaryType);

  if (
    tagSet.has("shape|base|wall") ||
    (tagSet.has("shape|base") && tagSet.has("shape|wall"))
  ) {
    if (!typeTags.includes("wall")) typeTags.push("wall");
    if (!typeTags.includes("base")) typeTags.push("base");
  }
  if (tagSet.has("build|s2w")) typeTags.push("s2w");
  if (tagSet.has("build|separate wall")) typeTags.push("separate_wall");
  if (tagSet.has("build|wall on tile")) typeTags.push("wall_on_tile");
  if (tagSet.has("build|thick wall")) typeTags.push("thick_wall");
  if (tagSet.has("shape|corner")) typeTags.push("corner");
  if (tagSet.has("component|secret_door")) typeTags.push("secret_door");
  return typeTags;
}

function parseTextureTags(tags) {
  let versionTheme = null;
  const textureSets = [];
  const textureTags = [];
  for (const tag of tags) {
    if (!tag.startsWith("texture|")) continue;
    const parts = tag.split("|");
    if (parts.length === 3) {
      versionTheme = parts[1] + "%" + parts[2];
      textureTags.push({ name: parts[2], isVersion: true, tag });
      if (!textureSets.includes(parts[1])) {
        textureSets.push(parts[1]);
      }
      if (!textureTags.some((t) => t.name === parts[1] && !t.isVersion)) {
        textureTags.push({
          name: parts[1],
          isVersion: false,
          tag: `texture|${parts[1]}`,
        });
      }
    } else if (
      parts.length === 2 &&
      parts[1] !== "plain" &&
      !textureSets.includes(parts[1])
    ) {
      textureSets.push(parts[1]);
      if (!textureTags.some((t) => t.name === parts[1])) {
        textureTags.push({ name: parts[1], isVersion: false, tag });
      }
    }
  }
  const theme = versionTheme || textureSets.join("+") || "plain";
  return { theme, textureTags };
}

function parseFormat(tags) {
  let format = null;
  for (const tag of tags) {
    if (
      tag.startsWith("connection|") &&
      !tag.startsWith("connection|side") &&
      !tag.startsWith("connection|pegs")
    ) {
      const parts = tag.split("|");
      if (parts.length === 2) {
        format = parts[1];
      } else if (parts.length >= 3) {
        format = parts.slice(1).join("+");
      }
    }
  }
  return format;
}

function parseAttributes(tagSet) {
  const attributes = [];
  if (tagSet.has("connection|magnetic|flex")) {
    attributes.push("magnetic", "flex");
  } else if (tagSet.has("connection|magnetic")) {
    attributes.push("magnetic");
  }
  if (tagSet.has("connection|openlock|topless")) {
    attributes.push("topless");
  }
  if (tagSet.has("connection|side")) attributes.push("side");
  if (tagSet.has("connection|left")) attributes.push("left");
  if (tagSet.has("connection|right")) attributes.push("right");
  return attributes;
}

// Model grid footprint (in tiles), e.g. { x: 2, y: 1 }. Prefers explicit
// `size|width|N` / `size|depth|N` tags, falling back to parsing conventional
// size hints out of the file name (e.g. "...2x1...", "...BA...").
function parseSize(tags, blueprint) {
  let sizeX = null;
  let sizeY = null;
  for (const tag of tags) {
    if (tag.startsWith("size|width|")) {
      sizeX = parseFloat(tag.split("|")[2]) || null;
    }
    if (tag.startsWith("size|depth|")) {
      sizeY = parseFloat(tag.split("|")[2]) || null;
    }
  }

  if (sizeX === null && sizeY === null) {
    const fname = blueprint?.file_name || blueprint?.blueprint_name || "";
    const sizeMatch = fname.match(/\.(\d+)x(\d+)\./);
    if (sizeMatch) {
      sizeX = parseInt(sizeMatch[1]);
      sizeY = parseInt(sizeMatch[2]);
    } else {
      const letterMatch = fname.match(/\.([A-Z](?:\+[A-Z])?)\./);
      if (letterMatch) {
        const codes = {
          A: [1, 1],
          B: [2, 2],
          BA: [2, 1],
          C: [1, 1],
          L: [1, 1],
          "2x": [2, 1],
        };
        const c = codes[letterMatch[1]];
        if (c) {
          sizeX = c[0];
          sizeY = c[1];
        }
      }
    }
  }

  if (sizeX !== null && sizeY === null) sizeY = sizeX;
  if (sizeX === null && sizeY !== null) sizeX = sizeY;
  return sizeX !== null ? { x: sizeX, y: sizeY } : null;
}

export function parseCatalogTags(tags, blueprint) {
  const tagSet = new Set(tags);

  const primaryType = parsePrimaryType(tagSet);
  const typeTags = parseTypeTags(tagSet, primaryType);
  const { theme, textureTags } = parseTextureTags(tags);
  const format = parseFormat(tags);
  const attributes = parseAttributes(tagSet);
  const size = parseSize(tags, blueprint);

  const themeInfo = getCatalogThemeInfo(theme);

  const fileName = blueprint?.file_name || blueprint?.blueprint_name || "";

  return {
    _id: generateModelId(fileName, blueprint?.file_md5 || null),
    theme,
    textureTags,
    themeLabel: themeInfo.label,
    color: resolveTextureColor(textureTags, theme),
    typeTags,
    primaryType,
    size,
    format,
    attributes,
    fileName: blueprint?.file_name || blueprint?.blueprint_name || "",
    displayName:
      typeTags
        .filter((t) => t !== primaryType)
        .join("+")
        .replace(/_/g, " ") || primaryType,
    source: "catalog",
    catalogId: blueprint?.id || null,
    sha: blueprint?.file_md5 || null,
    thumbnailUrl: blueprint?.images?.[0]?.image_url || null,
    storageUrl: blueprint?.storage_address || null,
    tags,
  };
}

export function blueprintToModelInfo(blueprint) {
  return parseCatalogTags(blueprint.tags || [], blueprint);
}

export async function fetchBlueprintById(id) {
  if (!id) throw new Error("Blueprint id is required");
  const resp = await fetchWithTimeout(
    `${API_BASE}/blueprints/${encodeURIComponent(id)}`,
    {},
    30000,
  );
  if (!resp.ok) throw new Error(`Catalog API error: ${resp.status}`);
  return resp.json();
}

export async function searchBlueprints({
  require = [],
  deny = [],
  limit = 50,
  nextToken = null,
  prevToken = null,
  search = "",
  signal = null,
} = {}) {
  const params = new URLSearchParams();
  params.set("models", "true");
  params.set("blueprints", "true");
  if (limit) params.set("limit", String(limit));
  if (nextToken) params.set("next", nextToken);
  if (prevToken) params.set("previous", prevToken);
  const searchTerms = search
    .split("+")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (searchTerms.length > 0) {
    // The catalog endpoint does not handle literal plus-separated searches,
    // so use the last term remotely and apply the complete match locally.
    params.set("search", searchTerms.at(-1));
  }

  const body = {};
  if (require.length > 0) body.require = require.map((t) => ({ tag: t }));
  if (deny.length > 0) body.deny = deny.map((t) => ({ tag: t }));

  const url = `${API_BASE}/blueprints/tags?${params.toString()}`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    30000,
  );

  if (!resp.ok) throw new Error(`Catalog API error: ${resp.status}`);
  const data = await resp.json();

  const blueprints = (data.blueprints || []).filter((blueprint) => {
    if (searchTerms.length <= 1) return true;
    const searchable = [
      blueprint.blueprint_name,
      blueprint.file_name,
      blueprint.full_name,
      blueprint.search_text,
      blueprint.storage_address,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchTerms.every((term) => searchable.includes(term));
  });

  return {
    blueprints: blueprints.map((b) => ({
      ...b,
      modelInfo: blueprintToModelInfo(b),
    })),
    tagCounts: data.tag_counts || {},
    paging: data.paging || { total_count: 0 },
  };
}

export async function downloadBlueprintSTL(blueprint, onProgress) {
  const url = blueprint.storage_address || blueprint.modelInfo?.storageUrl;
  if (!url) throw new Error("No storage address for blueprint");

  let fetchUrl = url;
  if (url.startsWith("https://objects.openforge.tools/")) {
    fetchUrl =
      "/catalog-objects" + url.replace("https://objects.openforge.tools", "");
  }

  const resp = await fetchWithTimeout(fetchUrl, {}, 120000);
  if (!resp.ok) throw new Error(`Failed to download STL: ${resp.status}`);

  const contentLength = parseInt(resp.headers.get("content-length") || "0");
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && contentLength > 0) {
      onProgress(received / contentLength);
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return buffer;
}

export { getCatalogThemeInfo };
