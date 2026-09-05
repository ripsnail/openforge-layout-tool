import {
  getTypeIcon,
  getEffectiveTextureTags,
  formatTextureTag,
  escapeHtml,
} from "./modelCatalog.js";
import { searchBlueprints, downloadBlueprintSTL } from "./catalogApi.js";
import {
  initDownloadedModels,
  importBlueprint,
  isDownloaded,
  removeDownloaded,
  getDownloadedModels,
  getThumbnailUrl,
  hydrateMetadataFromServer,
  ensureCatalogThumbCached,
} from "./downloadedModels.js";
import {
  getOverride,
  hasOverride,
  setOverride,
  removeOverride,
  buildOverrideFromUI,
} from "./modelOverrides.js";

const TAG_CATEGORIES = [
  { key: "texture", label: "Texture", icon: "🎨" },
  { key: "shape", label: "Shape", icon: "📐" },
  { key: "connection", label: "Connection", icon: "🔗" },
  { key: "build", label: "Build System", icon: "🏗" },
  { key: "size", label: "Size", icon: "📏" },
  { key: "component", label: "Component", icon: "🧩" },
  { key: "decoration", label: "Decoration", icon: "✨" },
];

function formatModelName(model) {
  return (model.fileName || "").replace(/\.stl$/i, "");
}

function textureTagsSubtitle(model) {
  const tags = getEffectiveTextureTags(model) || [];
  return tags.map(formatTextureTag).join(" · ");
}

function readURLState() {
  const p = new URLSearchParams(window.location.search);
  return {
    selectedTags: p.has("req")
      ? p
          .getAll("req")
          .flatMap((v) => v.split(",").map(decodeURIComponent))
          .filter(Boolean)
      : [],
    deniedTags: p.has("deny")
      ? p
          .getAll("deny")
          .flatMap((v) => v.split(",").map(decodeURIComponent))
          .filter(Boolean)
      : [],
    activeTab: p.get("tab") || "saved",
    filterText: p.get("q") || "",
  };
}

function writeURLState(selectedTags, deniedTags, activeTab, filterText) {
  const p = new URLSearchParams();
  if (selectedTags.length)
    p.set("req", selectedTags.map(encodeURIComponent).join(","));
  if (deniedTags.length)
    p.set("deny", deniedTags.map(encodeURIComponent).join(","));
  if (activeTab && activeTab !== "saved") p.set("tab", activeTab);
  if (filterText) p.set("q", filterText);
  const qs = p.toString();
  const url = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function modelToTags(model) {
  const tags = [];

  if (model.primaryType) tags.push(`shape|${model.primaryType}`);
  if (model.theme) tags.push(`texture|${model.theme}`);
  if (model.format) {
    for (const f of model.format.split("+")) {
      tags.push(`connection|${f}`);
    }
  }
  if (model.typeTags) {
    for (const t of model.typeTags) {
      if (t === model.primaryType) continue;
      if (t === "s2w") tags.push("build|s2w");
      else if (t === "separate_wall") tags.push("build|separate wall");
      else if (t === "wall_on_tile") tags.push("build|wall on tile");
      else if (t === "thick_wall") tags.push("build|thick wall");
      else if (t === "corner") tags.push("shape|corner");
      else if (t === "wall") tags.push("shape|wall");
      else if (t === "secret_door") tags.push("component|secret_door");
    }
  }
  if (model.attributes) {
    for (const a of model.attributes) {
      if (a === "side") tags.push("connection|side");
      if (a === "magnetic") tags.push("connection|magnetic");
      if (a === "flex") tags.push("connection|magnetic|flex");
      if (a === "topless") tags.push("connection|openlock|topless");
      if (a === "left") tags.push("connection|left");
      if (a === "right") tags.push("connection|right");
    }
  }
  if (model.size) {
    tags.push(`size|width|${model.size.x}`);
    tags.push(`size|depth|${model.size.y}`);
  }

  return tags;
}

function buildTagCounts(models) {
  const counts = {};
  for (const model of models) {
    const tags = model.tags || modelToTags(model);
    for (const tag of tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts;
}

function matchesTags(model, selectedTags, deniedTags) {
  const tags = model.tags || modelToTags(model);
  const tagSet = new Set(tags);

  for (const req of selectedTags) {
    if (!tagSet.has(req)) return false;
  }
  for (const den of deniedTags) {
    if (tagSet.has(den)) return false;
  }
  return true;
}

export function initPalette(onSelectModel) {
  const container = document.getElementById("model-palette");
  const searchInput = document.getElementById("search-input");

  initDownloadedModels();

  let activeModel = null;
  let filterText = "";
  let tagSearchText = "";
  let selectedTags = [];
  let deniedTags = [];
  let catalogResults = [];
  let catalogTagCounts = {};
  let localTagCounts = {};
  let isLoadingCatalog = false;
  let catalogRequestId = 0;
  let catalogAbortController = null;
  let catalogPaging = { total_count: 0 };
  let nextToken = null;
  let lastCatalogSearch = null;
  let activeTab = "saved";

  const urlState = readURLState();
  selectedTags = urlState.selectedTags;
  deniedTags = urlState.deniedTags;
  activeTab = urlState.activeTab;
  filterText = urlState.filterText;

  const downloadedModels = getDownloadedModels();
  const allLocalModels = [...downloadedModels];

  localTagCounts = buildTagCounts(allLocalModels);

  function refreshSavedModels() {
    const currentModels = getDownloadedModels();
    downloadedModels.splice(0, downloadedModels.length, ...currentModels);
    allLocalModels.splice(0, allLocalModels.length, ...currentModels);
    localTagCounts = buildTagCounts(allLocalModels);
    render();
  }

  hydrateMetadataFromServer().then(({ added, pruned }) => {
    if ((!added || added.length === 0) && (!pruned || pruned.length === 0))
      return;
    if (pruned && pruned.length > 0) {
      const prunedSet = new Set(pruned);
      for (let i = downloadedModels.length - 1; i >= 0; i--) {
        if (prunedSet.has(downloadedModels[i]._id))
          downloadedModels.splice(i, 1);
      }
      for (let i = allLocalModels.length - 1; i >= 0; i--) {
        if (prunedSet.has(allLocalModels[i]._id)) allLocalModels.splice(i, 1);
      }
    }
    for (const info of added || []) {
      downloadedModels.push({ ...info, source: "downloaded" });
      allLocalModels.push({ ...info, source: "downloaded" });
    }
    localTagCounts = buildTagCounts(allLocalModels);
    render();
  });

  function render() {
    container.innerHTML = "";

    const tabBar = document.createElement("div");
    tabBar.className = "palette-tabs";
    ["saved", "catalog"].forEach((tab) => {
      const btn = document.createElement("button");
      btn.className = `palette-tab ${activeTab === tab ? "active" : ""}`;
      btn.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
      btn.addEventListener("click", () => {
        activeTab = tab;
        writeURLState(selectedTags, deniedTags, activeTab, filterText);
        render();
      });
      tabBar.appendChild(btn);
    });
    container.appendChild(tabBar);

    if (activeTab === "saved") {
      renderLocalModels();
    } else if (activeTab === "catalog") {
      if (
        !isLoadingCatalog &&
        (catalogResults.length === 0 || filterText !== lastCatalogSearch)
      ) {
        loadCatalogResults();
        return;
      }
      renderCatalogSearch();
    }

    renderOverridePanel();
  }

  function renderLocalModels() {
    const searchSection = document.createElement("div");
    searchSection.className = "catalog-search-section";

    const tagTree = document.createElement("div");
    tagTree.className = "tag-tree";
    renderTagTree(tagTree, localTagCounts, () => render());
    searchSection.appendChild(tagTree);

    renderActiveFilters(searchSection, () => render());
    container.appendChild(searchSection);

    const resultsDiv = document.createElement("div");
    resultsDiv.className = "catalog-results";

    let models = allLocalModels.filter((m) => {
      if (!matchesTags(m, selectedTags, deniedTags)) return false;
      if (filterText) {
        const q = filterText.toLowerCase();
        return formatModelName(m).toLowerCase().includes(q);
      }
      return true;
    });

    models.sort((a, b) => formatModelName(a).localeCompare(formatModelName(b)));

    const countEl = document.createElement("div");
    countEl.className = "catalog-count";
    countEl.textContent = `${models.length} of ${allLocalModels.length} models`;
    resultsDiv.appendChild(countEl);

    for (const model of models) {
      resultsDiv.appendChild(createModelItem(model));
    }

    container.appendChild(resultsDiv);
    document.getElementById("model-count").textContent =
      `Models: ${allLocalModels.length}`;
  }

  function renderCatalogSearch() {
    const searchSection = document.createElement("div");
    searchSection.className = "catalog-search-section";

    const tagTree = document.createElement("div");
    tagTree.className = "tag-tree";
    renderTagTree(tagTree, catalogTagCounts, () => loadCatalogResults());
    searchSection.appendChild(tagTree);

    renderActiveFilters(searchSection, () => loadCatalogResults());
    container.appendChild(searchSection);

    const resultsDiv = document.createElement("div");
    resultsDiv.className = "catalog-results";

    if (isLoadingCatalog) {
      resultsDiv.innerHTML = '<div class="loading">Searching catalog...</div>';
    } else if (catalogResults.length === 0) {
      resultsDiv.innerHTML =
        '<div class="no-models">Select tags or search to find parts</div>';
    } else {
      const countEl = document.createElement("div");
      countEl.className = "catalog-count";
      countEl.textContent = `${catalogPaging.total_count} results`;
      resultsDiv.appendChild(countEl);

      for (const blueprint of catalogResults) {
        resultsDiv.appendChild(createCatalogItem(blueprint));
      }

      if (nextToken) {
        const loadMore = document.createElement("button");
        loadMore.className = "load-more-btn";
        loadMore.textContent = "Load more...";
        loadMore.addEventListener("click", () => loadCatalogResults(true));
        resultsDiv.appendChild(loadMore);
      }
    }

    container.appendChild(resultsDiv);
    document.getElementById("model-count").textContent =
      `Catalog: ${catalogPaging.total_count || 0} results`;
  }

  function renderTagTree(treeContainer, tagCounts, onTagChange) {
    const searchDiv = document.createElement("div");
    searchDiv.className = "tag-search-wrap";

    const searchInput = document.createElement("input");
    searchInput.className = "tag-search-input";
    searchInput.placeholder = "Search tags...";
    searchInput.value = tagSearchText;
    searchInput.addEventListener("input", () => {
      tagSearchText = searchInput.value;
      filterTagTree(treeContainer, tagCounts, onTagChange);
    });
    searchDiv.appendChild(searchInput);
    treeContainer.appendChild(searchDiv);

    const tagsDiv = document.createElement("div");
    tagsDiv.className = "tag-tree-tags";
    treeContainer.appendChild(tagsDiv);

    buildTagCategories(tagsDiv, tagCounts, onTagChange);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "tag-tree-resize";
    treeContainer.appendChild(resizeHandle);

    initTagTreeResize(resizeHandle, tagsDiv);
  }

  function initTagTreeResize(handle, tagsDiv) {
    const key = "tag-tree-height";
    const saved = parseInt(localStorage.getItem(key));
    if (!isNaN(saved)) {
      document.documentElement.style.setProperty(
        "--tag-tree-height",
        saved + "px",
      );
    }

    let startY, startH;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = tagsDiv.offsetHeight;
      handle.classList.add("active");
      const onMove = (e) => {
        const h = Math.min(Math.max(startH + (e.clientY - startY), 80), 600);
        tagsDiv.style.setProperty("--tag-tree-height", h + "px");
        document.documentElement.style.setProperty(
          "--tag-tree-height",
          h + "px",
        );
      };
      const onUp = () => {
        handle.classList.remove("active");
        const current = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--tag-tree-height",
          ),
        );
        if (!isNaN(current)) localStorage.setItem(key, current);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function filterTagTree(treeContainer, tagCounts, onTagChange) {
    const tagsDiv = treeContainer.querySelector(".tag-tree-tags");
    if (tagsDiv) {
      tagsDiv.innerHTML = "";
      buildTagCategories(tagsDiv, tagCounts, onTagChange);
    }
  }

  function buildTagCategories(tagsDiv, tagCounts, onTagChange) {
    const q = tagSearchText.toLowerCase();

    for (const cat of TAG_CATEGORIES) {
      const tagsInCat = Object.entries(tagCounts)
        .filter(([tag]) => tag.startsWith(cat.key + "|"))
        .filter(([tag]) => {
          if (!q) return true;
          return tag.toLowerCase().includes(q);
        })
        .sort((a, b) => b[1] - a[1]);

      if (tagsInCat.length === 0) continue;

      const catDiv = document.createElement("div");
      catDiv.className = "tag-category";

      const catHeader = document.createElement("div");
      catHeader.className = "tag-category-header";
      catHeader.innerHTML = `<span class="tag-cat-icon">${cat.icon}</span> ${cat.label}`;
      catHeader.addEventListener("click", () => {
        const body = catHeader.nextElementSibling;
        const isHidden = body.style.display === "none";
        body.style.display = isHidden ? "" : "none";
        catHeader
          .querySelector(".tag-cat-icon")
          .classList.toggle("collapsed", !isHidden);
      });
      catDiv.appendChild(catHeader);

      const catBody = document.createElement("div");
      catBody.className = "tag-category-body";

      for (const [tag, count] of tagsInCat) {
        const depth = tag.split("|").length;
        const tagBtn = document.createElement("button");
        tagBtn.className = "tag-btn";
        if (selectedTags.includes(tag)) tagBtn.classList.add("selected");
        if (deniedTags.includes(tag)) tagBtn.classList.add("denied");
        tagBtn.style.paddingLeft = `${depth * 8 + 4}px`;

        // Category header already shows the first segment (e.g. "texture"),
        // so buttons show the remainder: towne|broken_stucco-a.
        const tagRemainder = tag.split("|").slice(1).join("|");
        tagBtn.innerHTML = `${escapeHtml(tagRemainder)} <span class="tag-count">${count}</span>`;
        tagBtn.title = tag;

        tagBtn.addEventListener("click", (e) => {
          if (e.shiftKey) {
            if (!deniedTags.includes(tag)) {
              deniedTags.push(tag);
            } else {
              deniedTags = deniedTags.filter((t) => t !== tag);
            }
          } else {
            if (!selectedTags.includes(tag)) {
              selectedTags.push(tag);
            } else {
              selectedTags = selectedTags.filter((t) => t !== tag);
            }
          }
          writeURLState(selectedTags, deniedTags, activeTab, filterText);
          onTagChange();
        });

        catBody.appendChild(tagBtn);
      }

      catDiv.appendChild(catBody);
      tagsDiv.appendChild(catDiv);
    }
  }

  function renderActiveFilters(parent, onTagChange) {
    if (selectedTags.length === 0 && deniedTags.length === 0) return;

    const activeFilters = document.createElement("div");
    activeFilters.className = "active-filters";
    for (const tag of selectedTags) {
      const chip = document.createElement("span");
      chip.className = "filter-chip require";
      chip.textContent = tag;
      chip.title = `Required: ${tag}`;
      chip.addEventListener("click", () => {
        selectedTags = selectedTags.filter((t) => t !== tag);
        writeURLState(selectedTags, deniedTags, activeTab, filterText);
        onTagChange();
      });
      activeFilters.appendChild(chip);
    }
    for (const tag of deniedTags) {
      const chip = document.createElement("span");
      chip.className = "filter-chip deny";
      chip.textContent = "!" + tag;
      chip.title = `Denied: ${tag}`;
      chip.addEventListener("click", () => {
        deniedTags = deniedTags.filter((t) => t !== tag);
        writeURLState(selectedTags, deniedTags, activeTab, filterText);
        onTagChange();
      });
      activeFilters.appendChild(chip);
    }
    parent.appendChild(activeFilters);
  }

  async function loadCatalogResults(append = false) {
    // Guard against overlapping searches: only the latest request may
    // write results (a slow older response must not overwrite newer ones).
    // Also abort the previous in-flight request so it doesn't keep consuming
    // bandwidth/API quota after it's no longer needed.
    if (catalogAbortController) catalogAbortController.abort();
    const controller = new AbortController();
    catalogAbortController = controller;
    const requestId = ++catalogRequestId;
    isLoadingCatalog = true;
    render();

    try {
      const result = await searchBlueprints({
        require: selectedTags,
        deny: deniedTags,
        limit: 50,
        nextToken: append ? nextToken : null,
        search: filterText,
        signal: controller.signal,
      });

      if (requestId !== catalogRequestId) return;

      lastCatalogSearch = filterText;

      if (append) {
        catalogResults = [...catalogResults, ...result.blueprints];
      } else {
        catalogResults = result.blueprints;
      }

      catalogTagCounts = result.tagCounts;
      catalogPaging = result.paging;
      nextToken = result.paging.next_token || null;
    } catch (e) {
      if (requestId !== catalogRequestId) return;
      if (e?.name === "AbortError") return;
      console.error("Catalog search failed:", e);
      if (!append) catalogResults = [];
    }

    if (requestId !== catalogRequestId) return;
    isLoadingCatalog = false;
    render();
  }

  function createModelItem(model) {
    const item = document.createElement("div");
    item.className = "model-item";
    if (activeModel && activeModel._id === model._id) {
      item.classList.add("active");
    }
    if (model.hasOverride) {
      item.classList.add("has-override");
    }

    const icon = getTypeIcon(model.primaryType);
    const overrideIndicator = hasOverride(model.fileName)
      ? '<span class="override-badge" title="Has manual overrides">⚙</span>'
      : "";
    const remoteSavedThumb = model.thumbnailUrl || null;
    const savedThumbUrl =
      getThumbnailUrl(model._id) ||
      (remoteSavedThumb ? ensureCatalogThumbCached(remoteSavedThumb) : null);
    const thumbUrl = savedThumbUrl || remoteSavedThumb;

    const thumbEl = document.createElement("div");
    thumbEl.className = "model-thumb-wrap";
    if (thumbUrl) {
      const img = document.createElement("img");
      img.className = "model-thumb";
      img.src = thumbUrl;
      img.alt = "";
      img.loading = "lazy";
      if (remoteSavedThumb && thumbUrl !== remoteSavedThumb) {
        img.onerror = () => {
          img.onerror = null;
          img.src = remoteSavedThumb;
        };
      }
      thumbEl.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "model-preview";
      span.textContent = icon;
      thumbEl.appendChild(span);
    }

    if (thumbUrl) {
      let floating = null;
      thumbEl.addEventListener("mouseenter", () => {
        const rect = thumbEl.getBoundingClientRect();
        floating = document.createElement("div");
        floating.className = "model-thumb-float";
        const fImg = document.createElement("img");
        fImg.src = thumbUrl;
        if (remoteSavedThumb && thumbUrl !== remoteSavedThumb) {
          fImg.onerror = () => {
            fImg.onerror = null;
            fImg.src = remoteSavedThumb;
          };
        }
        fImg.alt = "";
        floating.appendChild(fImg);
        floating.style.left = rect.left + "px";
        floating.style.bottom = window.innerHeight - rect.bottom + "px";
        document.body.appendChild(floating);
      });
      thumbEl.addEventListener("mouseleave", () => {
        if (floating) {
          floating.remove();
          floating = null;
        }
      });
    }

    const tagsSubtitle = textureTagsSubtitle(model);
    item.innerHTML = `
      <span class="model-text"><span class="model-name">${escapeHtml(formatModelName(model))}${overrideIndicator}</span>${tagsSubtitle ? `<span class="model-tags">${escapeHtml(tagsSubtitle)}</span>` : ""}</span>
    `;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      if (activeModel && activeModel._id === model._id) {
        activeModel = null;
        onSelectModel(null);
      } else {
        activeModel = model;
        onSelectModel(model);
      }
      render();
    });

    item.title = model.fileName;

    const actions = document.createElement("div");
    actions.className = "model-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "model-action-btn";
    editBtn.textContent = "⚙";
    editBtn.title = "Edit overrides";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showOverrideEditor(model);
    });
    actions.appendChild(editBtn);

    if (model.source === "downloaded") {
      const removeBtn = document.createElement("button");
      removeBtn.className = "model-action-btn danger";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove imported model";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeDownloaded(model._id);
        const idx = downloadedModels.findIndex((m) => m._id === model._id);
        if (idx >= 0) downloadedModels.splice(idx, 1);
        const aIdx = allLocalModels.findIndex((m) => m._id === model._id);
        if (aIdx >= 0) allLocalModels.splice(aIdx, 1);
        localTagCounts = buildTagCounts(allLocalModels);
        render();
      });
      actions.appendChild(removeBtn);
    }

    item.appendChild(actions);
    item.appendChild(thumbEl);
    return item;
  }

  function createCatalogItem(blueprint) {
    const item = document.createElement("div");
    item.className = "model-item catalog-item";

    const modelInfo = blueprint.modelInfo;
    const icon = getTypeIcon(modelInfo.primaryType);
    const downloaded = isDownloaded(blueprint.file_name);
    const thumbEl = document.createElement("div");
    thumbEl.className = "model-thumb-wrap";
    const remoteThumbUrl = blueprint.images?.[0]?.image_url || null;
    const cachedThumbUrl =
      getThumbnailUrl(modelInfo._id) ||
      (remoteThumbUrl ? ensureCatalogThumbCached(remoteThumbUrl) : null);
    const catThumbUrl = cachedThumbUrl || remoteThumbUrl;
    if (catThumbUrl) {
      const img = document.createElement("img");
      img.className = "model-thumb";
      img.src = catThumbUrl;
      img.alt = "";
      img.loading = "lazy";
      if (remoteThumbUrl && catThumbUrl !== remoteThumbUrl) {
        img.onerror = () => {
          img.onerror = null;
          img.src = remoteThumbUrl;
        };
      }
      thumbEl.appendChild(img);

      let floating = null;
      thumbEl.addEventListener("mouseenter", () => {
        const rect = thumbEl.getBoundingClientRect();
        floating = document.createElement("div");
        floating.className = "model-thumb-float";
        const fImg = document.createElement("img");
        fImg.src = catThumbUrl;
        if (remoteThumbUrl && catThumbUrl !== remoteThumbUrl) {
          fImg.onerror = () => {
            fImg.onerror = null;
            fImg.src = remoteThumbUrl;
          };
        }
        fImg.alt = "";
        floating.appendChild(fImg);
        floating.style.left = rect.left + "px";
        floating.style.bottom = window.innerHeight - rect.bottom + "px";
        document.body.appendChild(floating);
      });
      thumbEl.addEventListener("mouseleave", () => {
        if (floating) {
          floating.remove();
          floating = null;
        }
      });
    } else {
      const span = document.createElement("span");
      span.className = "model-preview";
      span.textContent = icon;
      thumbEl.appendChild(span);
    }

    const catTagsSubtitle = textureTagsSubtitle(modelInfo);
    item.innerHTML = `
      <span class="model-text"><span class="model-name">${escapeHtml(formatModelName(modelInfo))}</span>${catTagsSubtitle ? `<span class="model-tags">${escapeHtml(catTagsSubtitle)}</span>` : ""}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "model-actions";

    if (!downloaded) {
      const importBtn = document.createElement("button");
      importBtn.className = "model-action-btn import-btn";
      importBtn.textContent = "+";
      importBtn.title = "Import model";
      importBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        importBtn.textContent = "...";
        importBtn.disabled = true;
        try {
          const stlData = await downloadBlueprintSTL(blueprint);
          const newModelInfo = await importBlueprint(blueprint, stlData);
          const savedModel = { ...newModelInfo, source: "downloaded" };
          downloadedModels.push(savedModel);
          allLocalModels.push(savedModel);
          localTagCounts = buildTagCounts(allLocalModels);
          importBtn.textContent = "✓";
          importBtn.title = "Imported!";
          render();
        } catch (err) {
          console.error("Import failed:", err);
          importBtn.textContent = "!";
          importBtn.title = "Import failed";
          setTimeout(() => {
            importBtn.textContent = "+";
            importBtn.disabled = false;
          }, 2000);
        }
      });
      actions.appendChild(importBtn);
    } else {
      const check = document.createElement("span");
      check.className = "imported-check";
      check.textContent = "✓ Imported";
      actions.appendChild(check);
    }

    item.appendChild(actions);
    item.appendChild(thumbEl);

    item.addEventListener("click", () => {
      activeModel = modelInfo;
      onSelectModel(modelInfo);
      render();
    });

    item.title = blueprint.file_name;
    return item;
  }

  function showOverrideEditor(model) {
    const existing = getOverride(model.fileName) || {};
    const panel = document.getElementById("override-panel");
    if (!panel) return;

    panel.innerHTML = "";
    panel.classList.add("visible");

    const header = document.createElement("div");
    header.className = "override-header";
    header.innerHTML = `
      <span>Override: ${escapeHtml(formatModelName(model))}</span>
      <button class="override-close">×</button>
    `;
    header.querySelector(".override-close").addEventListener("click", () => {
      panel.classList.remove("visible");
    });
    panel.appendChild(header);

    const form = document.createElement("div");
    form.className = "override-form";

    const typeSelect = document.createElement("div");
    typeSelect.className = "override-field";
    typeSelect.innerHTML = `
      <label>Type Override</label>
      <select id="ov-primaryType">
        <option value="auto">Auto-detect</option>
        <option value="floor">Floor</option>
        <option value="wall">Wall</option>
        <option value="base">Base</option>
        <option value="column">Column</option>
        <option value="corner">Corner</option>
        <option value="other">Other</option>
      </select>
    `;
    form.appendChild(typeSelect);

    const sizeFields = document.createElement("div");
    sizeFields.className = "override-row";
    sizeFields.innerHTML = `
      <div class="override-field">
        <label>Width (tiles)</label>
        <input type="number" id="ov-sizeX" min="0.5" max="8" step="0.5" value="${escapeHtml(existing.size?.x || model.size?.x || "")}" />
      </div>
      <div class="override-field">
        <label>Depth (tiles)</label>
        <input type="number" id="ov-sizeY" min="0.5" max="8" step="0.5" value="${escapeHtml(existing.size?.y || model.size?.y || "")}" />
      </div>
    `;
    form.appendChild(sizeFields);

    const formatField = document.createElement("div");
    formatField.className = "override-field";
    formatField.innerHTML = `
      <label>Connection Format</label>
      <input type="text" id="ov-format" placeholder="e.g. openlock, openforge" value="${escapeHtml(existing.format || model.format || "")}" />
    `;
    form.appendChild(formatField);

    const themeField = document.createElement("div");
    themeField.className = "override-field";
    themeField.innerHTML = `
      <label>Theme Override</label>
      <input type="text" id="ov-theme" placeholder="e.g. dungeon_stone" value="${escapeHtml(existing.theme || model.theme || "")}" />
    `;
    form.appendChild(themeField);

    const nameField = document.createElement("div");
    nameField.className = "override-field";
    nameField.innerHTML = `
      <label>Display Name</label>
      <input type="text" id="ov-displayName" placeholder="Custom name" value="${escapeHtml(existing.displayName || "")}" />
    `;
    form.appendChild(nameField);

    const fpHeader = document.createElement("div");
    fpHeader.className = "override-section-header";
    fpHeader.textContent = "Custom Footprint (mm)";
    form.appendChild(fpHeader);

    const fpFields = document.createElement("div");
    fpFields.className = "override-row";
    fpFields.innerHTML = `
      <div class="override-field">
        <label>Width (mm)</label>
        <input type="number" id="ov-fpW" min="1" max="200" step="0.1" value="${escapeHtml(existing.customFootprint?.w || "")}" placeholder="Auto" />
      </div>
      <div class="override-field">
        <label>Depth (mm)</label>
        <input type="number" id="ov-fpD" min="1" max="200" step="0.1" value="${escapeHtml(existing.customFootprint?.d || "")}" placeholder="Auto" />
      </div>
    `;
    form.appendChild(fpFields);

    const snapHeader = document.createElement("div");
    snapHeader.className = "override-section-header";
    snapHeader.textContent = "Snap Behavior";
    form.appendChild(snapHeader);

    const snapFields = document.createElement("div");
    snapFields.className = "override-snap";
    const snap = existing.snapBehavior || {};
    snapFields.innerHTML = `
      <label class="override-checkbox">
        <input type="checkbox" id="ov-isBase" ${snap.isBase ? "checked" : ""} />
        Is Base Tile
      </label>
      <label class="override-checkbox">
        <input type="checkbox" id="ov-acceptsWalls" ${snap.acceptsWalls ? "checked" : ""} />
        Accepts Walls
      </label>
      <label class="override-checkbox">
        <input type="checkbox" id="ov-acceptsFloors" ${snap.acceptsFloors ? "checked" : ""} />
        Accepts Floors (stackable)
      </label>
      <div class="override-field">
        <label>Custom Snap Radius (mm)</label>
        <input type="number" id="ov-snapRadius" min="0" max="500" step="1" value="${escapeHtml(snap.customSnapRadius || "")}" placeholder="Default (127)" />
      </div>
    `;
    form.appendChild(snapFields);

    const btnRow = document.createElement("div");
    btnRow.className = "override-buttons";

    const saveBtn = document.createElement("button");
    saveBtn.className = "override-save-btn";
    saveBtn.textContent = "Save Overrides";
    saveBtn.addEventListener("click", () => {
      const uiState = {
        primaryType: document.getElementById("ov-primaryType").value,
        sizeX: document.getElementById("ov-sizeX").value,
        sizeY: document.getElementById("ov-sizeY").value,
        format: document.getElementById("ov-format").value,
        theme: document.getElementById("ov-theme").value,
        displayName: document.getElementById("ov-displayName").value,
        customWidth: document.getElementById("ov-fpW").value,
        customDepth: document.getElementById("ov-fpD").value,
        isBase: document.getElementById("ov-isBase").checked,
        acceptsWalls: document.getElementById("ov-acceptsWalls").checked,
        acceptsFloors: document.getElementById("ov-acceptsFloors").checked,
        customSnapRadius: document.getElementById("ov-snapRadius").value,
      };

      const overrideData = buildOverrideFromUI(uiState);
      if (Object.keys(overrideData).length === 0) {
        removeOverride(model.fileName);
      } else {
        setOverride(model.fileName, overrideData);
      }

      panel.classList.remove("visible");
      render();
    });
    btnRow.appendChild(saveBtn);

    if (hasOverride(model.fileName)) {
      const resetBtn = document.createElement("button");
      resetBtn.className = "override-reset-btn";
      resetBtn.textContent = "Reset to Default";
      resetBtn.addEventListener("click", () => {
        removeOverride(model.fileName);
        panel.classList.remove("visible");
        render();
      });
      btnRow.appendChild(resetBtn);
    }

    form.appendChild(btnRow);
    panel.appendChild(form);

    const typeSelectEl = document.getElementById("ov-primaryType");
    if (existing.primaryType) {
      typeSelectEl.value = existing.primaryType;
    } else if (model.primaryType) {
      typeSelectEl.value = model.primaryType;
    }
  }

  function renderOverridePanel() {
    let panel = document.getElementById("override-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "override-panel";
      document.getElementById("sidebar").appendChild(panel);
    }
  }

  let catalogSearchDebounce = null;
  searchInput.addEventListener("input", (e) => {
    filterText = e.target.value;
    writeURLState(selectedTags, deniedTags, activeTab, filterText);
    if (activeTab === "catalog") {
      clearTimeout(catalogSearchDebounce);
      if (catalogAbortController) {
        catalogAbortController.abort();
        catalogAbortController = null;
        catalogRequestId++;
        isLoadingCatalog = false;
      }
      catalogSearchDebounce = setTimeout(() => {
        nextToken = null;
        loadCatalogResults();
      }, 500);
    } else {
      render();
    }
  });

  render();

  if (Object.keys(catalogTagCounts).length === 0 && activeTab === "catalog") {
    loadCatalogResults();
  }

  return { refreshSavedModels };
}
