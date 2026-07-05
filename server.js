const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const rooms = require("./server/rooms.js");
const BOARD = require("./public/js/board-data.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function safe(socket, fn) {
  try {
    fn();
  } catch (err) {
    socket.emit("errorMsg", err.message || "একটি সমস্যা হয়েছে");
  }
}

function broadcast(roomCode) {
  const room = rooms.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit("state", room.getPublicState());
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.on("createRoom", ({ name, avatar, token, color }, cb) => {
    safe(socket, () => {
      const playerId = nanoid(10);
      const room = rooms.createRoom(playerId);
      room.addPlayer({ playerId, name, avatar, token, color, socketId: socket.id });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      cb && cb({ ok: true, roomCode: room.code, playerId });
      broadcast(room.code);
    });
  });

  socket.on("joinRoom", ({ roomCode, name, avatar, token, color }, cb) => {
    safe(socket, () => {
      const room = rooms.getRoom(roomCode);
      if (!room) throw new Error("রুম পাওয়া যায়নি — কোড যাচাই করুন");
      if (room.started) throw new Error("খেলা ইতিমধ্যে শুরু হয়ে গেছে");
      if (room.players.length >= room.maxPlayers) throw new Error("রুম পূর্ণ হয়ে গেছে");
      const playerId = nanoid(10);
      room.addPlayer({ playerId, name, avatar, token, color, socketId: socket.id });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      cb && cb({ ok: true, roomCode: room.code, playerId });
      broadcast(room.code);
    });
  });

  socket.on("rejoinRoom", ({ roomCode, playerId }, cb) => {
    safe(socket, () => {
      const room = rooms.getRoom(roomCode);
      if (!room) throw new Error("রুম আর নেই");
      const player = room.reconnectPlayer(playerId, socket.id);
      if (!player) throw new Error("এই রুমে আপনার তথ্য পাওয়া যায়নি");
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      cb && cb({ ok: true });
      broadcast(room.code);
    });
  });

  socket.on("toggleReady", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const player = room.getPlayer(socket.data.playerId);
      player.ready = !player.ready;
      broadcast(room.code);
    });
  });

  socket.on("setMaxPlayers", (max) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      if (room.hostPlayerId !== socket.data.playerId) throw new Error("শুধু হোস্ট এটি পরিবর্তন করতে পারবেন");
      room.maxPlayers = Math.max(BOARD.CONSTANTS.MIN_PLAYERS, Math.min(BOARD.CONSTANTS.MAX_PLAYERS, max));
      broadcast(room.code);
    });
  });

  socket.on("startGame", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      if (room.hostPlayerId !== socket.data.playerId) throw new Error("শুধু হোস্ট খেলা শুরু করতে পারবেন");
      if (!room.allReady()) throw new Error("সবাই প্রস্তুত না হওয়া পর্যন্ত খেলা শুরু করা যাবে না");
      room.startGame();
      broadcast(room.code);
    });
  });

  socket.on("rollDice", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.rollDice(socket.data.playerId);
      broadcast(room.code);
    });
  });

  socket.on("buyProperty", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.buyProperty(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("declineProperty", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.declineProperty(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("placeBid", (amount) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.placeBid(socket.data.playerId, amount);
      broadcast(room.code);
    });
  });

  socket.on("passAuction", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.passAuction(socket.data.playerId);
      broadcast(room.code);
    });
  });

  socket.on("payJailFine", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.payJailFine(socket.data.playerId);
      broadcast(room.code);
    });
  });

  socket.on("useJailCard", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.useJailCard(socket.data.playerId);
      broadcast(room.code);
    });
  });

  socket.on("mortgage", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.mortgageProperty(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("unmortgage", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.unmortgageProperty(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("buildHouse", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.buildHouse(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("sellHouse", (tileId) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.sellHouse(socket.data.playerId, tileId);
      broadcast(room.code);
    });
  });

  socket.on("proposeTrade", ({ toId, offer }) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.proposeTrade(socket.data.playerId, toId, offer);
      broadcast(room.code);
    });
  });

  socket.on("respondTrade", (accept) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.respondTrade(socket.data.playerId, accept);
      broadcast(room.code);
    });
  });

  socket.on("declareBankrupt", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const player = room.getPlayer(socket.data.playerId);
      const creditorId = room.turn.pendingAction && room.turn.pendingAction.creditorId;
      room.declareBankrupt(player, creditorId ? room.getPlayer(creditorId) : null);
      broadcast(room.code);
    });
  });

  socket.on("endTurn", () => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.endTurn(socket.data.playerId);
      broadcast(room.code);
    });
  });

  socket.on("sendChat", (text) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const player = room.getPlayer(socket.data.playerId);
      const clean = String(text || "").slice(0, 300);
      if (!clean.trim()) return;
      room.chatLog.push({ playerId: player.id, name: player.name, text: clean, ts: Date.now() });
      broadcast(room.code);
    });
  });

  socket.on("disconnect", () => {
    const room = rooms.getRoom(socket.data.roomCode);
    if (!room) return;
    const player = room.getPlayer(socket.data.playerId);
    if (player) player.connected = false;
    if (!room.started) {
      room.removePlayer(socket.data.playerId);
    }
    broadcast(room.code);
  });
});

// Auto-resolve auctions whose countdown has expired.
setInterval(() => {
  for (const room of rooms.rooms.values()) {
    if (room.auction) {
      const expired = Date.now() >= room.auction.endsAt;
      const onlyOneLeft = room.auction.biddersLeft.length <= 1 && room.auction.highestBidderId;
      if (expired || onlyOneLeft) {
        room.endAuction();
        broadcast(room.code);
      }
    }
  }
  rooms.cleanup();
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ধনী হবার মজার খেলা সার্ভার চলছে: http://localhost:${PORT}`);
});
