import { loadModelGeometry } from "./modelLoader.js";
import { getManifest } from "./downloadedModels.js";
import { setStorageItem } from "./storage.js";

const INCH = 25.4;
const USER_TEMPLATES_KEY = "openforge-user-templates";

let userTemplates = [];

function modelInfoFromTile(tile, file) {
  const lowerFile = String(file || "").toLowerCase();
  const primaryType = lowerFile.includes("#base")
    ? "base"
    : lowerFile.includes("#wall")
      ? "wall"
      : lowerFile.includes("#column") || lowerFile.includes("column.")
        ? "column"
        : lowerFile.includes("#floor")
          ? "floor"
          : "other";
  const typeTags = primaryType === "other" ? [] : [primaryType];
  if (primaryType === "base" && lowerFile.includes("wall")) {
    typeTags.push("wall");
  }

  return {
    _id: tile._id || tile.sha || file,
    fileName: file,
    primaryType,
    typeTags,
    textureTags: [],
    theme: (file.split("#")[0] || "plain").replace(/%/g, "+"),
    storageUrl: tile.storageUrl || null,
    sha: tile.sha || null,
    catalogId: tile.catalogId || null,
    source: "downloaded",
  };
}

export function initUserTemplates() {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY);
    if (raw) userTemplates = JSON.parse(raw);
  } catch (e) {
    userTemplates = [];
  }
}

function saveUserTemplates() {
  setStorageItem(USER_TEMPLATES_KEY, JSON.stringify(userTemplates));
}

export function getUserTemplates() {
  return [...userTemplates];
}

export function saveUserTemplate(name, tiles) {
  const template = { name, tiles, createdAt: Date.now() };
  userTemplates.push(template);
  saveUserTemplates();
  return template;
}

export function deleteUserTemplate(index) {
  userTemplates.splice(index, 1);
  saveUserTemplates();
}

export function selectionToTemplate(selectedMeshes) {
  if (selectedMeshes.length === 0) return null;
  const first = selectedMeshes[0].position;
  return selectedMeshes.map((m) => ({
    _id: m.userData.modelInfo._id || null,
    file: m.userData.modelInfo.fileName,
    x: m.position.x - first.x,
    y: m.position.y,
    z: m.position.z - first.z,
    rx: m.rotation.x,
    ry: m.rotation.y,
    rz: m.rotation.z,
    storageUrl: m.userData.modelInfo.storageUrl || null,
    catalogId: m.userData.modelInfo.catalogId || null,
    sha: m.userData.modelInfo.sha || null,
  }));
}

export const TEMPLATES = [
  {
    name: "Towne S2W Corner",
    tiles: [
      {
        file: "wood#base+wall.BA.openlock+topless,magnetic+flex.stl",
        x: 0,
        z: 0,
        sha: "b3082adb63599134b331efe93056ef91",
        storageUrl:
          "https://objects.openforge.tools/models/b3082a/b3082adb63599134b331efe93056ef91.stl",
      },
      {
        file: "wood#base+wall.BA+mirror.openlock+topless,magnetic+flex.stl",
        x: INCH,
        z: INCH,
        ry: -Math.PI / 2,
        sha: "e07e88a707797e90e599e207ef82ee1e",
        storageUrl:
          "https://objects.openforge.tools/models/e07e88/e07e88a707797e90e599e207ef82ee1e.stl",
      },
      {
        file: "towne+broken_stucco-a#corner+left,wall.2x.openforge,side.stl",
        x: 0,
        y: 6,
        z: 0,
        ry: Math.PI,
        sha: "b85ae40888df338183ff8289b7a2ead4",
        storageUrl:
          "https://objects.openforge.tools/models/b85ae4/b85ae40888df338183ff8289b7a2ead4.stl",
      },
      {
        file: "towne+broken_stucco-a#corner+right,wall.2x.openforge,side.stl",
        x: INCH,
        y: 6,
        z: INCH,
        ry: Math.PI / 2,
        sha: "0addbfe559a8aab588a54891c79f8e78",
        storageUrl:
          "https://objects.openforge.tools/models/0addbf/0addbfe559a8aab588a54891c79f8e78.stl",
      },
      {
        file: "plain#base+s2w+square+corner.2x2.openlock+topless,magnetic+flex.stl",
        x: 0,
        z: INCH,
        sha: "b751390e1f4bcc7486b4eaadc244fa92",
        storageUrl:
          "https://objects.openforge.tools/models/b75139/b751390e1f4bcc7486b4eaadc244fa92.stl",
      },
      {
        file: "towne%wood#floor+corner+s2w.2x2.openforge.stl",
        x: 0,
        y: 6.01,
        z: INCH,
        ry: Math.PI,
        sha: "9905c76c35d980ce419f8745494c235b",
        storageUrl:
          "https://objects.openforge.tools/models/9905c7/9905c76c35d980ce419f8745494c235b.stl",
      },
      {
        file: "towne%wood#column.col+I.side.stl",
        x: INCH,
        z: 0,
        ry: Math.PI / 2,
        sha: "abf608895f8da267724009317e389dc5",
        storageUrl:
          "https://objects.openforge.tools/models/abf608/abf608895f8da267724009317e389dc5.stl",
      },
    ],
  },
  {
    name: "Towne S2W Wall",
    tiles: [
      {
        file: "wood#base+wall.A.openlock+topless,magnetic+flex.stl",
        x: 0,
        z: 0,
        ry: Math.PI / 2,
        sha: "9fdf2302fc323f0b91f39a90c3da97be",
        storageUrl:
          "https://objects.openforge.tools/models/9fdf23/9fdf2302fc323f0b91f39a90c3da97be.stl",
      },
      {
        file: "plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl",
        x: INCH,
        z: 0,
        ry: Math.PI / 2,
        sha: "54ceb90719a75f620911d0696911c324",
        storageUrl:
          "https://objects.openforge.tools/models/54ceb9/54ceb90719a75f620911d0696911c324.stl",
      },
      {
        file: "towne#floor+wall+s2w.2x2.openforge.stl",
        x: INCH,
        y: 6.01,
        z: 0,
        ry: -Math.PI / 2,
        sha: "d6f936794ea3fe2bd3e421b642a2c8ec",
        storageUrl:
          "https://objects.openforge.tools/models/d6f936/d6f936794ea3fe2bd3e421b642a2c8ec.stl",
      },
      {
        file: "towne+broken_stucco-a#wall.A.openforge.stl",
        x: 0,
        y: 6.08,
        z: 0,
        ry: -Math.PI / 2,
        sha: "fdffa4be8afdda733672735bcf5c7efc",
        storageUrl:
          "https://objects.openforge.tools/models/fdffa4/fdffa4be8afdda733672735bcf5c7efc.stl",
      },
    ],
  },
  {
    name: "Towne 2x2 Floor",
    tiles: [
      {
        file: "plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl",
        x: 0,
        z: 0,
        sha: "c3695cab8e5d70b03be37ff82aa2de06",
        storageUrl:
          "https://objects.openforge.tools/models/c3695c/c3695cab8e5d70b03be37ff82aa2de06.stl",
      },
      {
        file: "towne%wood#floor.2x2.openforge.stl",
        x: 0,
        y: 6.01,
        z: 0,
        sha: "e470404184334c4525eb5852ea96b3f3",
        storageUrl:
          "https://objects.openforge.tools/models/e47040/e470404184334c4525eb5852ea96b3f3.stl",
      },
    ],
  },
  {
    name: "Towne S2W Door",
    tiles: [
      {
        file: "plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl",
        x: 0,
        z: 0,
        ry: -Math.PI / 2,
        sha: "54ceb90719a75f620911d0696911c324",
        storageUrl:
          "https://objects.openforge.tools/models/54ceb9/54ceb90719a75f620911d0696911c324.stl",
      },
      {
        file: "towne#floor+wall+s2w.2x2.openforge.stl",
        x: 0,
        y: 6.01,
        z: 0,
        ry: Math.PI / 2,
        sha: "d6f936794ea3fe2bd3e421b642a2c8ec",
        storageUrl:
          "https://objects.openforge.tools/models/d6f936/d6f936794ea3fe2bd3e421b642a2c8ec.stl",
      },
      {
        file: "towne+stone-stucco#door+rectangular.A.openforge.stl",
        x: INCH,
        y: 6.08,
        z: 0,
        ry: Math.PI / 2,
        sha: "a0a48ccdef09bd83d7fc55b5af684d60",
        storageUrl:
          "https://objects.openforge.tools/models/a0a48c/a0a48ccdef09bd83d7fc55b5af684d60.stl",
      },
      {
        file: "wood#base+wall.A.openlock+topless,magnetic+flex.stl",
        x: INCH,
        z: 0,
        ry: -Math.PI / 2,
        sha: "9fdf2302fc323f0b91f39a90c3da97be",
        storageUrl:
          "https://objects.openforge.tools/models/9fdf23/9fdf2302fc323f0b91f39a90c3da97be.stl",
      },
    ],
  },
  {
    name: "Dungeon Stone S2W Corner",
    tiles: [
      {
        "file": "dungeon_stone#base+wall.BA+mirror.openlock+topless,magnetic+flex.stl",
        "x": 0,
        "y": 0,
        "z": 0,
        "rx": 0,
        "ry": 4.71238898038469,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/0b58db/0b58dbfb1020dc1e9871352fbc7d1c44.stl",
        "sha": "0b58dbfb1020dc1e9871352fbc7d1c44"
      },
      {
        "file": "plain#base+s2w+square+corner.2x2.openlock+topless,magnetic+flex.stl",
        "x": -25.400000000000006,
        "y": 0,
        "z": 0,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/b75139/b751390e1f4bcc7486b4eaadc244fa92.stl",
        "sha": "b751390e1f4bcc7486b4eaadc244fa92"
      },
      {
        "file": "dungeon_stone%block#floor+s2w+corner.2x2.openforge.stl",
        "x": -25.400000000000006,
        "y": 6.010000228881836,
        "z": 0,
        "rx": 0,
        "ry": 3.141592653589793,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/9bcb01/9bcb0172fb74115fda1293a7cfb4712c.stl",
        "sha": "9bcb0172fb74115fda1293a7cfb4712c"
      },
      {
        "file": "dungeon_stone#base+wall.BA.openlock+topless,magnetic+flex.stl",
        "x": -25.400000000000006,
        "y": 0,
        "z": -25.39999999999999,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/ef9635/ef9635aafc269e47fe94c527e793d1fa.stl",
        "sha": "ef9635aafc269e47fe94c527e793d1fa"
      },
      {
        "file": "dungeon_stone#column.col+I.side.stl",
        "x": 0,
        "y": 0,
        "z": -25.39999999999999,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/3bdba7/3bdba7c44dbfede63262e1783dc5d248.stl",
        "sha": "3bdba7c44dbfede63262e1783dc5d248"
      },
      {
        "file": "dungeon_stone#wall.BA.openforge.stl",
        "x": -25.400000000000006,
        "y": 6.010000228881836,
        "z": -25.39999999999999,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/d22797/d22797b00a2f58d25bf4382598cf6823.stl",
        "sha": "d22797b00a2f58d25bf4382598cf6823"
      },
      {
        "file": "dungeon_stone#wall.BA.openforge.stl",
        "x": 0,
        "y": 6.010000228881836,
        "z": 0,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/d22797/d22797b00a2f58d25bf4382598cf6823.stl",
        "sha": "d22797b00a2f58d25bf4382598cf6823"
      }
    ]
  },
  {
    name: "Dungeon Stone S2W Wall",
    tiles: [
      {
        "file": "plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl",
        "x": -6.349999999999994,
        "y": 0,
        "z": -101.6,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/54ceb9/54ceb90719a75f620911d0696911c324.stl",
        "sha": "54ceb90719a75f620911d0696911c324"
      },
      {
        "file": "dungeon_stone%block#floor+s2w+wall.2x2.openforge.stl",
        "x": -6.349999999999994,
        "y": 6.010000228881836,
        "z": -101.6,
        "rx": 0,
        "ry": 4.71238898038469,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/003540/00354077087ede614c97ed2c51d8d798.stl",
        "sha": "00354077087ede614c97ed2c51d8d798"
      },
      {
        "file": "dungeon_stone#base+wall.A.openlock+topless,magnetic+flex.stl",
        "x": -31.75,
        "y": 0,
        "z": -101.6,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/89ff41/89ff411a86b3b4d4bde831c27f2ce4b6.stl",
        "sha": "89ff411a86b3b4d4bde831c27f2ce4b6"
      },
      {
        "file": "dungeon_stone#wall.A.openforge.stl",
        "x": -31.75,
        "y": 6.010000228881836,
        "z": -101.6,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/0ddb1b/0ddb1b2020f193f27de372857d2b7803.stl",
        "sha": "0ddb1b2020f193f27de372857d2b7803"
      }
    ]
  },
  {
    name: "Dungeon Stone 2x2 Floor",
    tiles: [
      {
        "file": "plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl",
        "x": 0,
        "y": 0,
        "z": 0,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/c3695c/c3695cab8e5d70b03be37ff82aa2de06.stl",
        "sha": "c3695cab8e5d70b03be37ff82aa2de06"
      },
      {
        "file": "dungeon_stone%block#floor.2x2.openforge.stl",
        "x": 0,
        "y": 6.0099992752075195,
        "z": 0,
        "rx": 0,
        "ry": 0,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/e1d767/e1d767845e1862fff3a8dc04e86133c6.stl",
        "sha": "e1d767845e1862fff3a8dc04e86133c6"
      }
    ]
  },
  {
    name: "Dungeon Stone S2W Door",
    tiles: [
      {
        "file": "plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl",
        "x": -88.89999999999998,
        "y": 0,
        "z": -95.25,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/54ceb9/54ceb90719a75f620911d0696911c324.stl",
        "sha": "54ceb90719a75f620911d0696911c324"
      },
      {
        "file": "dungeon_stone%block#floor+s2w+wall.2x2.openforge.stl",
        "x": -88.89999999999998,
        "y": 6.010000228881836,
        "z": -95.25,
        "rx": 0,
        "ry": 4.71238898038469,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/003540/00354077087ede614c97ed2c51d8d798.stl",
        "sha": "00354077087ede614c97ed2c51d8d798"
      },
      {
        "file": "dungeon_stone#base+wall.A.openlock+topless,magnetic+flex.stl",
        "x": -114.29999999999998,
        "y": 0,
        "z": -95.25,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/89ff41/89ff411a86b3b4d4bde831c27f2ce4b6.stl",
        "sha": "89ff411a86b3b4d4bde831c27f2ce4b6"
      },
      {
        "file": "dungeon_stone%block#wall,door+arched+narrow.A.openforge.stl",
        "x": -114.29999999999998,
        "y": 6.35,
        "z": -95.25,
        "rx": 0,
        "ry": 1.5707963267948966,
        "rz": 0,
        "storageUrl": "https://objects.openforge.tools/models/543661/543661716d08c93bee83208998253bd5.stl",
        "sha": "543661716d08c93bee83208998253bd5"
      }
    ]
  },
];

export async function resolveTemplateTiles(template) {
  const manifest = getManifest();
  const resolved = [];

  for (const tile of template.tiles) {
    const file = tile.file || tile.fileName;
    let modelInfo;
    const entry = tile._id ? manifest.find((m) => m._id === tile._id) : null;
    const entryBySha =
      !entry && tile.sha
        ? manifest.find(
            (m) => m.sha === tile.sha || m.modelInfo?.sha === tile.sha,
          )
        : null;
    const entryByFile =
      !entry && !entryBySha && file
        ? manifest.find((m) => m.fileName === file)
        : null;
    const useEntry = entry || entryBySha || entryByFile;
    modelInfo = useEntry?.modelInfo
      ? { ...useEntry.modelInfo }
      : modelInfoFromTile(tile, file);
    if (tile._id) modelInfo._id = tile._id;
    if (tile.storageUrl && !modelInfo.storageUrl) {
      modelInfo.storageUrl = tile.storageUrl;
    }
    if (tile.catalogId && !modelInfo.catalogId) {
      modelInfo.catalogId = tile.catalogId;
    }
    if (tile.sha && !modelInfo.sha) {
      modelInfo.sha = tile.sha;
    }

    try {
      const geometry = await loadModelGeometry(modelInfo);
      resolved.push({ tile, modelInfo, geometry });
    } catch (e) {
      console.warn("Template tile load failed:", file, e);
    }
  }

  return resolved;
}
