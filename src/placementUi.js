import { escapeHtml } from "./modelCatalog.js";

export function updateModelCount(count) {
  const el = document.getElementById("model-count");
  if (el) el.textContent = `Models: ${count}`;
}

export function updateBom(placedMeshes) {
  const list = document.getElementById("bom-list");
  if (!list) return;
  const counts = {};
  for (const mesh of placedMeshes) {
    const name = mesh.userData.modelInfo.fileName || "unknown";
    counts[name] = (counts[name] || 0) + 1;
  }
  const entries = Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  if (entries.length === 0) {
    list.innerHTML = '<div class="bom-empty">No models placed</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      ([name, count]) =>
        `<div class="bom-item"><span class="bom-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="bom-count">${count}</span></div>`,
    )
    .join("");
}
