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

// ----------------------------------------------------------------------------
// "এক ফোনে একাধিক খেলোয়াড়" (multiple players on one phone / pass-and-play):
// a single socket connection can hold more than one seat in the same room —
// e.g. three friends sharing one phone, each picking a name/token/color, and
// passing the phone around on their turn. Every seat the socket has created
// or rejoined is tracked in claimedPlayerIds; any action can be performed
// "as" any of those seats by sending __asPlayerId, which the server verifies
// before touching game state.
// ----------------------------------------------------------------------------
function actingPlayerId(socket, payload) {
  const requested = (payload && payload.__asPlayerId) || socket.data.playerId;
  if (!requested) throw new Error("কোনো সিট পাওয়া যায়নি");
  if (!socket.data.claimedPlayerIds || !socket.data.claimedPlayerIds.has(requested)) {
    throw new Error("এই সিটটি এই ডিভাইস থেকে নিয়ন্ত্রিত নয়");
  }
  return requested;
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;
  socket.data.claimedPlayerIds = new Set();

  socket.on("createRoom", ({ name, avatar, token, color }, cb) => {
    safe(socket, () => {
      const playerId = nanoid(10);
      const room = rooms.createRoom(playerId);
      room.addPlayer({ playerId, name, avatar, token, color, socketId: socket.id });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.data.claimedPlayerIds.add(playerId);
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
      socket.data.claimedPlayerIds.add(playerId);
      cb && cb({ ok: true, roomCode: room.code, playerId });
      broadcast(room.code);
    });
  });

  // Add another local seat to the room this socket is already in — used for
  // "pass and play" on one phone. Anyone already seated in a not-yet-started
  // room can add more local players (up to maxPlayers).
  socket.on("addLocalSeat", ({ name, avatar, token, color }, cb) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      if (!room) throw new Error("আগে একটি রুমে যোগ দিন");
      if (room.started) throw new Error("খেলা ইতিমধ্যে শুরু হয়ে গেছে");
      if (room.players.length >= room.maxPlayers) throw new Error("রুম পূর্ণ হয়ে গেছে");
      const playerId = nanoid(10);
      room.addPlayer({ playerId, name, avatar, token, color, socketId: socket.id });
      socket.data.claimedPlayerIds.add(playerId);
      cb && cb({ ok: true, roomCode: room.code, playerId });
      broadcast(room.code);
    });
  });

  socket.on("rejoinRoom", ({ roomCode, playerId, extraPlayerIds }, cb) => {
    safe(socket, () => {
      const room = rooms.getRoom(roomCode);
      if (!room) throw new Error("রুম আর নেই");
      const player = room.reconnectPlayer(playerId, socket.id);
      if (!player) throw new Error("এই রুমে আপনার তথ্য পাওয়া যায়নি");
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.data.claimedPlayerIds.add(playerId);
      // Re-claim any other local (pass-and-play) seats this device held.
      (extraPlayerIds || []).forEach((pid) => {
        if (room.reconnectPlayer(pid, socket.id)) socket.data.claimedPlayerIds.add(pid);
      });
      cb && cb({ ok: true });
      broadcast(room.code);
    });
  });

  socket.on("toggleReady", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const pid = actingPlayerId(socket, payload);
      const player = room.getPlayer(pid);
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

  socket.on("rollDice", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.rollDice(actingPlayerId(socket, payload));
      broadcast(room.code);
    });
  });

  socket.on("buyProperty", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.buyProperty(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("declineProperty", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.declineProperty(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("placeBid", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.placeBid(actingPlayerId(socket, payload), payload.amount);
      broadcast(room.code);
    });
  });

  socket.on("passAuction", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.passAuction(actingPlayerId(socket, payload));
      broadcast(room.code);
    });
  });

  socket.on("payJailFine", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.payJailFine(actingPlayerId(socket, payload));
      broadcast(room.code);
    });
  });

  socket.on("useJailCard", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.useJailCard(actingPlayerId(socket, payload));
      broadcast(room.code);
    });
  });

  socket.on("mortgage", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.mortgageProperty(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("unmortgage", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.unmortgageProperty(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("buildHouse", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.buildHouse(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("sellHouse", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.sellHouse(actingPlayerId(socket, payload), payload.tileId);
      broadcast(room.code);
    });
  });

  socket.on("proposeTrade", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.proposeTrade(actingPlayerId(socket, payload), payload.toId, payload.offer);
      broadcast(room.code);
    });
  });

  socket.on("respondTrade", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.respondTrade(actingPlayerId(socket, payload), payload.accept);
      broadcast(room.code);
    });
  });

  socket.on("declareBankrupt", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const pid = actingPlayerId(socket, payload);
      const player = room.getPlayer(pid);
      const creditorId = room.turn.pendingAction && room.turn.pendingAction.creditorId;
      room.declareBankrupt(player, creditorId ? room.getPlayer(creditorId) : null);
      broadcast(room.code);
    });
  });

  socket.on("endTurn", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      room.endTurn(actingPlayerId(socket, payload));
      broadcast(room.code);
    });
  });

  socket.on("sendChat", (payload) => {
    safe(socket, () => {
      const room = rooms.getRoom(socket.data.roomCode);
      const pid = actingPlayerId(socket, payload);
      const player = room.getPlayer(pid);
      const clean = String((payload && payload.text) || "").slice(0, 300);
      if (!clean.trim()) return;
      room.chatLog.push({ playerId: player.id, name: player.name, text: clean, ts: Date.now() });
      broadcast(room.code);
    });
  });

  socket.on("disconnect", () => {
    const room = rooms.getRoom(socket.data.roomCode);
    if (!room) return;
    // Mark every seat this socket held (could be several, for pass-and-play)
    // as disconnected, not just the primary one.
    const idsToMark = socket.data.claimedPlayerIds && socket.data.claimedPlayerIds.size
      ? Array.from(socket.data.claimedPlayerIds)
      : [socket.data.playerId];
    idsToMark.forEach((pid) => {
      const player = room.getPlayer(pid);
      if (player) player.connected = false;
      if (!room.started) room.removePlayer(pid);
    });
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
