const { Room } = require("./gameEngine.js");

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 confusion

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateCode() {
    let code;
    do {
      code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostPlayerId) {
    const code = this.generateCode();
    const room = new Room(code, hostPlayerId);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || "").toUpperCase());
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }

  // Clean up empty / stale rooms periodically
  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const allDisconnected = room.players.length > 0 && room.players.every((p) => !p.connected);
      const stale = now - room.createdAt > 1000 * 60 * 60 * 6; // 6 hours
      if (room.players.length === 0 || (allDisconnected && stale)) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = new RoomManager();
