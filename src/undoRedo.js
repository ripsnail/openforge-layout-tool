export class UndoRedoManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    this._trim();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const cmd = this.undoStack.pop();
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const cmd = this.redoStack.pop();
    cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  _trim() {
    if (this.undoStack.length > 200) {
      this.undoStack = this.undoStack.slice(-200);
    }
  }
}

export class PlaceCommand {
  constructor(system, mesh) {
    this.system = system;
    this.mesh = mesh;
  }

  execute() {
    this.system.scene.add(this.mesh);
    this.system.placedMeshes.push(this.mesh);
  }

  undo() {
    this.system.scene.remove(this.mesh);
    const idx = this.system.placedMeshes.indexOf(this.mesh);
    if (idx >= 0) this.system.placedMeshes.splice(idx, 1);
  }
}

export class RemoveCommand {
  constructor(system, mesh) {
    this.system = system;
    this.mesh = mesh;
  }

  execute() {
    this.system.scene.remove(this.mesh);
    const idx = this.system.placedMeshes.indexOf(this.mesh);
    if (idx >= 0) this.system.placedMeshes.splice(idx, 1);
  }

  undo() {
    this.system.scene.add(this.mesh);
    this.system.placedMeshes.push(this.mesh);
  }
}

export class MoveCommand {
  constructor(mesh, oldPos, newPos) {
    this.mesh = mesh;
    this.oldPos = oldPos.clone();
    this.newPos = newPos.clone();
  }

  execute() {
    this.mesh.position.copy(this.newPos);
  }

  undo() {
    this.mesh.position.copy(this.oldPos);
  }
}

export class RotateCommand {
  constructor(mesh, axis, oldRot, newRot) {
    this.mesh = mesh;
    this.axis = axis;
    this.oldRot = oldRot;
    this.newRot = newRot;
  }

  execute() {
    this.mesh.rotation[this.axis] = this.newRot;
  }

  undo() {
    this.mesh.rotation[this.axis] = this.oldRot;
  }
}

export class GroupRotateCommand {
  constructor(snapshots) {
    this.snapshots = snapshots;
  }

  execute() {
    for (const s of this.snapshots) {
      s.mesh.position.copy(s.newPos);
      s.mesh.rotation.set(...s.newRot);
    }
  }

  undo() {
    for (const s of this.snapshots) {
      s.mesh.position.copy(s.oldPos);
      s.mesh.rotation.set(...s.oldRot);
    }
  }
}

export class BatchCommand {
  constructor(commands) {
    this.commands = commands;
  }

  execute() {
    for (const cmd of this.commands) cmd.execute();
  }

  undo() {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}
