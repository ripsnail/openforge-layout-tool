import * as THREE from 'three';
import { getTileFootprintMm, isBaseTile, isFloorTile, isWallTile } from './modelCatalog.js';
import { getSnapPoints, isSnapPointEnabled } from './snapPoints.js';

const INCH = 25.4;

export class ConnectionIndicatorSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = [];
  }

  show(modelInfo, position, rotation, geometry = null) {
    this.clear();
    if (!modelInfo) return;

    const points = getSnapPoints(modelInfo, rotation, geometry).filter(isSnapPointEnabled);

    const dotGeo = new THREE.SphereGeometry(INCH * 0.15, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x44cc88, depthWrite: false });

    const ringGeo = new THREE.RingGeometry(INCH * 0.2, INCH * 0.35, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x44cc88,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const pt of points) {
      const worldPt = new THREE.Vector3(
        position.x + pt.x,
        0.5,
        position.z + pt.z
      );

      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(worldPt);
      dot.name = 'connection-indicator';
      this.scene.add(dot);
      this.markers.push(dot);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(worldPt);
      ring.rotation.x = -Math.PI / 2;
      ring.name = 'connection-indicator';
      this.scene.add(ring);
      this.markers.push(ring);
    }
  }

  clear() {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
    }
    this.markers = [];
  }
}
