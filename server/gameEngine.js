// ============================================================================
// GAME ENGINE — one Room instance = one game/lobby
// ============================================================================

const { nanoid } = require("nanoid");
const BOARD = require("../public/js/board-data.js");
const { CHANCE_CARDS, LUCK_CARDS } = require("./cards.js");

const { TILES, CONSTANTS, GROUP_COLORS } = BOARD;
const TOTAL_TILES = TILES.length;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tileById(id) {
  return TILES[id];
}

function propertyGroupTiles(group) {
  return TILES.filter((t) => t.type === "property" && t.group === group);
}

class Room {
  constructor(code, hostPlayerId) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
    this.maxPlayers = 4;
    this.started = false;
    this.finished = false;
    this.players = []; // ordered = turn order once started
    this.propertyState = {}; // tileId -> { ownerId, houses, mortgaged }
    this.chanceDeck = shuffle(CHANCE_CARDS);
    this.luckDeck = shuffle(LUCK_CARDS);
    this.currentPlayerIndex = 0;
    this.turn = { hasRolled: false, doublesCount: 0, lastDice: null, pendingAction: null };
    this.auction = null; // { tileId, highestBid, highestBidderId, endsAt, biddersLeft }
    this.pendingTrade = null; // { id, fromId, toId, offer, status }
    this.chatLog = [];
    this.log = []; // game event log (system messages)
    this.createdAt = Date.now();
  }

  // ---- players -----------------------------------------------------------
  addPlayer({ playerId, name, avatar, token, color, socketId }) {
    if (this.players.find((p) => p.token === token)) {
      throw new Error("এই টোকেনটি ইতিমধ্যে নেওয়া হয়েছে");
    }
    const player = {
      id: playerId,
      socketId,
      name,
      avatar: avatar || "🙂",
      token,
      color,
      money: CONSTANTS.STARTING_MONEY,
      position: 0,
      properties: [],
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      ready: false,
      connected: true
    };
    this.players.push(player);
    return player;
  }

  getPlayer(playerId) {
    return this.players.find((p) => p.id === playerId);
  }

  reconnectPlayer(playerId, socketId) {
    const p = this.getPlayer(playerId);
    if (p) {
      p.socketId = socketId;
      p.connected = true;
    }
    return p;
  }

  removePlayer(playerId) {
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.hostPlayerId === playerId && this.players.length) {
      this.hostPlayerId = this.players[0].id;
    }
  }

  activePlayers() {
    return this.players.filter((p) => !p.bankrupt);
  }

  currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  allReady() {
    return this.players.length >= CONSTANTS.MIN_PLAYERS && this.players.every((p) => p.ready);
  }

  startGame() {
    this.started = true;
    this.currentPlayerIndex = 0;
    this.pushLog("খেলা শুরু হয়েছে! সবাইকে শুভকামনা।");
  }

  pushLog(text) {
    this.log.push({ text, ts: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  // ---- dice / movement -----------------------------------------------------
  rollDice(playerId) {
    const player = this.currentPlayer();
    if (!player || player.id !== playerId) throw new Error("এখন আপনার পালা নয়");
    if (this.turn.hasRolled && !this.turn.awaitingReRoll) throw new Error("আপনি ইতিমধ্যে ছক্কা চেলেছেন");
    if (this.turn.pendingAction) throw new Error("আগের সিদ্ধান্ত সম্পন্ন করুন");

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const isDouble = d1 === d2;
    this.turn.lastDice = [d1, d2];
    this.turn.hasRolled = true;
    this.turn.awaitingReRoll = false;

    if (player.inJail) {
      if (isDouble) {
        player.inJail = false;
        player.jailTurns = 0;
        this.pushLog(`${player.name} ডাবল তুলে জেল থেকে মুক্ত হলেন।`);
        this.movePlayer(player, d1 + d2);
      } else {
        player.jailTurns += 1;
        this.pushLog(`${player.name} জেলে আছেন (${player.jailTurns}/৩ বার চেষ্টা)।`);
        if (player.jailTurns >= 3) {
          player.money -= CONSTANTS.JAIL_FINE;
          player.inJail = false;
          player.jailTurns = 0;
          this.pushLog(`${player.name} ৩ বার ব্যর্থ হয়ে ৫০ টাকা জরিমানা দিয়ে মুক্ত হলেন।`);
          this.checkBankruptcy(player, null);
        }
        this.turn.canEndTurn = true;
      }
      return { d1, d2, isDouble };
    }

    if (isDouble) {
      this.turn.doublesCount += 1;
      if (this.turn.doublesCount >= CONSTANTS.MAX_DOUBLES_BEFORE_JAIL) {
        this.pushLog(`${player.name} পরপর ৩ বার ডাবল তোলায় সরাসরি জেলে গেলেন!`);
        this.sendToJail(player);
        this.turn.canEndTurn = true;
        return { d1, d2, isDouble, sentToJail: true };
      }
    } else {
      this.turn.doublesCount = 0;
    }

    this.movePlayer(player, d1 + d2);
    if (isDouble && !this.turn.pendingAction) {
      this.turn.awaitingReRoll = true;
      this.turn.hasRolled = false; // allow rolling again
    }
    return { d1, d2, isDouble };
  }

  movePlayer(player, steps) {
    const oldPos = player.position;
    let newPos = (oldPos + steps) % TOTAL_TILES;
    if (newPos < 0) newPos += TOTAL_TILES;
    const passedStart = oldPos + steps >= TOTAL_TILES && steps > 0;
    player.position = newPos;
    if (passedStart) {
      player.money += CONSTANTS.PASS_START_BONUS;
      this.pushLog(`${player.name} যাত্রা শুরু ঘর অতিক্রম করে ৳${CONSTANTS.PASS_START_BONUS} বোনাস পেলেন।`);
    }
    this.landOnTile(player);
  }

  sendToJail(player) {
    player.position = TILES.findIndex((t) => t.type === "jail");
    player.inJail = true;
    player.jailTurns = 0;
    this.turn.doublesCount = 0;
    this.turn.awaitingReRoll = false;
  }

  // ---- landing effects -----------------------------------------------------
  landOnTile(player) {
    const tile = tileById(player.position);
    this.pushLog(`${player.name} "${tile.name}" ঘরে এলেন।`);

    switch (tile.type) {
      case "property":
      case "railway":
      case "utility": {
        const state = this.propertyState[tile.id];
        if (!state || !state.ownerId) {
          this.turn.pendingAction = { type: "buyDecision", tileId: tile.id, playerId: player.id };
        } else if (state.ownerId !== player.id && !state.mortgaged) {
          const rent = this.calcRent(tile, state);
          this.transferMoney(player, this.getPlayer(state.ownerId), rent, `ভাড়া (${tile.name})`);
        }
        break;
      }
      case "tax":
        this.transferMoney(player, null, tile.amount, `কর পরিশোধ (${tile.name})`);
        break;
      case "chance":
        this.drawCard(player, "chance");
        break;
      case "luck":
        this.drawCard(player, "luck");
        break;
      case "goToJail":
        this.sendToJail(player);
        this.pushLog(`${player.name} কে জেলে পাঠানো হলো।`);
        break;
      case "jail":
      case "freeParking":
      case "start":
      default:
        break;
    }
  }

  calcRent(tile, state) {
    if (tile.type === "railway") {
      const owned = TILES.filter((t) => t.type === "railway" && this.propertyState[t.id] && this.propertyState[t.id].ownerId === state.ownerId).length;
      return tile.rent[Math.max(0, owned - 1)];
    }
    if (tile.type === "utility") {
      const ownedCount = TILES.filter((t) => t.type === "utility" && this.propertyState[t.id] && this.propertyState[t.id].ownerId === state.ownerId).length;
      const multiplier = ownedCount >= 2 ? 10 : 4;
      const [d1, d2] = this.turn.lastDice || [1, 1];
      return (d1 + d2) * multiplier;
    }
    // regular property
    if (state.houses > 0) {
      return tile.rent[state.houses]; // rent[0]=base, [1..4]=houses, [5]=hotel
    }
    const groupTiles = propertyGroupTiles(tile.group);
    const ownsFullGroup = groupTiles.every((t) => this.propertyState[t.id] && this.propertyState[t.id].ownerId === state.ownerId);
    return ownsFullGroup ? tile.rent[0] * 2 : tile.rent[0];
  }

  transferMoney(fromPlayer, toPlayerOrNull, amount, reason) {
    if (amount <= 0) return;
    fromPlayer.money -= amount;
    if (toPlayerOrNull) {
      toPlayerOrNull.money += amount;
      this.pushLog(`${fromPlayer.name} → ${toPlayerOrNull.name}: ৳${amount} (${reason})`);
    } else {
      this.pushLog(`${fromPlayer.name} ব্যাংককে ৳${amount} দিলেন (${reason})`);
    }
    this.checkBankruptcy(fromPlayer, toPlayerOrNull);
  }

  // ---- buying / auction ----------------------------------------------------
  buyProperty(playerId, tileId) {
    const player = this.getPlayer(playerId);
    const tile = tileById(tileId);
    if (!this.turn.pendingAction || this.turn.pendingAction.type !== "buyDecision" || this.turn.pendingAction.playerId !== playerId) {
      throw new Error("এখন কেনার সুযোগ নেই");
    }
    if (player.money < tile.price) throw new Error("পর্যাপ্ত টাকা নেই");
    player.money -= tile.price;
    player.properties.push(tileId);
    this.propertyState[tileId] = { ownerId: playerId, houses: 0, mortgaged: false };
    this.pushLog(`${player.name} "${tile.name}" কিনলেন ৳${tile.price} দিয়ে।`);
    this.turn.pendingAction = null;
    this.turn.canEndTurn = true;
  }

  declineProperty(playerId, tileId) {
    if (!this.turn.pendingAction || this.turn.pendingAction.type !== "buyDecision" || this.turn.pendingAction.playerId !== playerId) {
      throw new Error("এখন এই সিদ্ধান্ত নেওয়ার সময় নয়");
    }
    const tile = tileById(tileId);
    this.pushLog(`${this.getPlayer(playerId).name} "${tile.name}" কিনতে রাজি হননি — নিলাম শুরু হচ্ছে।`);
    this.turn.pendingAction = null;
    this.startAuction(tileId);
  }

  startAuction(tileId) {
    const tile = tileById(tileId);
    this.auction = {
      tileId,
      highestBid: CONSTANTS.AUCTION_MIN_BID - 1,
      highestBidderId: null,
      biddersLeft: this.activePlayers().map((p) => p.id),
      endsAt: Date.now() + CONSTANTS.AUCTION_COUNTDOWN_SECONDS * 1000
    };
    this.turn.pendingAction = { type: "auction", tileId };
  }

  placeBid(playerId, amount) {
    if (!this.auction) throw new Error("এখন কোনো নিলাম চলছে না");
    const player = this.getPlayer(playerId);
    if (amount <= this.auction.highestBid) throw new Error("বিডের পরিমাণ আগের সর্বোচ্চ বিড থেকে বেশি হতে হবে");
    if (amount > player.money) throw new Error("পর্যাপ্ত টাকা নেই");
    this.auction.highestBid = amount;
    this.auction.highestBidderId = playerId;
    this.auction.endsAt = Date.now() + CONSTANTS.AUCTION_COUNTDOWN_SECONDS * 1000;
    this.pushLog(`${player.name} নিলামে ৳${amount} বিড করলেন।`);
  }

  passAuction(playerId) {
    if (!this.auction) return;
    this.auction.biddersLeft = this.auction.biddersLeft.filter((id) => id !== playerId);
  }

  endAuction() {
    if (!this.auction) return;
    const { tileId, highestBid, highestBidderId } = this.auction;
    const tile = tileById(tileId);
    if (highestBidderId) {
      const winner = this.getPlayer(highestBidderId);
      winner.money -= highestBid;
      winner.properties.push(tileId);
      this.propertyState[tileId] = { ownerId: highestBidderId, houses: 0, mortgaged: false };
      this.pushLog(`নিলামে "${tile.name}" ${winner.name} জিতলেন ৳${highestBid} দিয়ে।`);
    } else {
      this.pushLog(`"${tile.name}" এর জন্য কেউ বিড করেননি — সম্পত্তিটি ব্যাংকের কাছেই থাকল।`);
    }
    this.auction = null;
    this.turn.pendingAction = null;
    this.turn.canEndTurn = true;
  }

  // ---- cards -----------------------------------------------------------------
  drawCard(player, deckName) {
    const deck = deckName === "chance" ? this.chanceDeck : this.luckDeck;
    const card = deck.shift();
    deck.push(card); // recycle to bottom
    this.pushLog(`${player.name} একটি ${deckName === "chance" ? "সুযোগ" : "ভাগ্য পরীক্ষা"} কার্ড তুললেন: ${card.text}`);
    this.applyCardEffect(player, card.effect);
    return card;
  }

  applyCardEffect(player, effect) {
    switch (effect.type) {
      case "money":
        if (effect.amount >= 0) player.money += effect.amount;
        else this.transferMoney(player, null, -effect.amount, "কার্ড");
        break;
      case "advanceTo": {
        const passedStart = player.position > effect.tile || (effect.tile === 0 && effect.collectBonus);
        player.position = effect.tile;
        if (effect.collectBonus) player.money += CONSTANTS.PASS_START_BONUS;
        this.landOnTile(player);
        break;
      }
      case "moveRelative":
        this.movePlayer(player, effect.steps);
        break;
      case "goToJail":
        this.sendToJail(player);
        break;
      case "advanceToNearest": {
        const candidates = TILES.filter((t) => t.type === effect.kind);
        let target = candidates.find((t) => t.id > player.position);
        if (!target) target = candidates[0];
        const steps = (target.id - player.position + TOTAL_TILES) % TOTAL_TILES;
        this.movePlayer(player, steps);
        if (effect.doubleRent) {
          const state = this.propertyState[target.id];
          if (state && state.ownerId && state.ownerId !== player.id) {
            const rent = this.calcRent(target, state) * 2;
            this.transferMoney(player, this.getPlayer(state.ownerId), rent, "দ্বিগুণ ভাড়া");
          }
        }
        break;
      }
      case "collectFromAll":
        this.activePlayers().forEach((p) => {
          if (p.id !== player.id) this.transferMoney(p, player, effect.amount, "কার্ড আদায়");
        });
        break;
      case "payAll":
        this.activePlayers().forEach((p) => {
          if (p.id !== player.id) this.transferMoney(player, p, effect.amount, "কার্ড প্রদান");
        });
        break;
      case "getOutOfJailCard":
        player.getOutOfJailCards += 1;
        break;
      case "repairTax": {
        let total = 0;
        player.properties.forEach((tid) => {
          const st = this.propertyState[tid];
          if (!st) return;
          if (st.houses === 5) total += effect.perHotel;
          else total += st.houses * effect.perHouse;
        });
        if (total > 0) this.transferMoney(player, null, total, "মেরামত খরচ");
        break;
      }
      case "freeHouse": {
        const eligible = player.properties.find((tid) => {
          const t = tileById(tid);
          const st = this.propertyState[tid];
          return t.type === "property" && st.houses < 4 && this.ownsFullGroup(player.id, t.group);
        });
        if (eligible) {
          this.propertyState[eligible].houses += 1;
          this.pushLog(`${player.name} বিনামূল্যে একটি বাড়ি পেলেন "${tileById(eligible).name}" তে।`);
        }
        break;
      }
      case "freeFromJailNow":
        if (player.inJail) {
          player.inJail = false;
          player.jailTurns = 0;
          this.pushLog(`${player.name} বিনা জরিমানায় জেল থেকে মুক্ত হলেন।`);
        }
        break;
      default:
        break;
    }
  }

  // ---- jail actions --------------------------------------------------------
  payJailFine(playerId) {
    const player = this.getPlayer(playerId);
    if (!player.inJail) throw new Error("আপনি জেলে নেই");
    if (player.money < CONSTANTS.JAIL_FINE) throw new Error("পর্যাপ্ত টাকা নেই");
    player.money -= CONSTANTS.JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.pushLog(`${player.name} ৫০ টাকা জরিমানা দিয়ে জেল থেকে মুক্ত হলেন।`);
  }

  useJailCard(playerId) {
    const player = this.getPlayer(playerId);
    if (!player.inJail) throw new Error("আপনি জেলে নেই");
    if (player.getOutOfJailCards < 1) throw new Error("আপনার কাছে মুক্তির কার্ড নেই");
    player.getOutOfJailCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    this.pushLog(`${player.name} মুক্তির কার্ড ব্যবহার করে জেল থেকে বের হলেন।`);
  }

  // ---- mortgage --------------------------------------------------------------
  mortgageProperty(playerId, tileId) {
    const state = this.propertyState[tileId];
    const tile = tileById(tileId);
    if (!state || state.ownerId !== playerId) throw new Error("এই সম্পত্তি আপনার নয়");
    if (state.mortgaged) throw new Error("ইতিমধ্যে বন্ধক আছে");
    if (state.houses > 0) throw new Error("বাড়ি/হোটেল বিক্রি করার পর বন্ধক রাখা যাবে");
    state.mortgaged = true;
    const player = this.getPlayer(playerId);
    player.money += Math.floor(tile.price / 2);
    this.pushLog(`${player.name} "${tile.name}" বন্ধক রেখে ৳${Math.floor(tile.price / 2)} নিলেন।`);
  }

  unmortgageProperty(playerId, tileId) {
    const state = this.propertyState[tileId];
    const tile = tileById(tileId);
    if (!state || state.ownerId !== playerId) throw new Error("এই সম্পত্তি আপনার নয়");
    if (!state.mortgaged) throw new Error("এই সম্পত্তি বন্ধক নেই");
    const payback = Math.floor(tile.price / 2 * (1 + CONSTANTS.MORTGAGE_INTEREST));
    const player = this.getPlayer(playerId);
    if (player.money < payback) throw new Error("পর্যাপ্ত টাকা নেই");
    player.money -= payback;
    state.mortgaged = false;
    this.pushLog(`${player.name} "${tile.name}" এর বন্ধক ৳${payback} দিয়ে মুক্ত করলেন।`);
  }

  // ---- houses / hotels ---------------------------------------------------
  ownsFullGroup(playerId, group) {
    const tiles = propertyGroupTiles(group);
    return tiles.every((t) => this.propertyState[t.id] && this.propertyState[t.id].ownerId === playerId && !this.propertyState[t.id].mortgaged);
  }

  buildHouse(playerId, tileId) {
    const tile = tileById(tileId);
    const state = this.propertyState[tileId];
    const player = this.getPlayer(playerId);
    if (!state || state.ownerId !== playerId) throw new Error("এই সম্পত্তি আপনার নয়");
    if (!this.ownsFullGroup(playerId, tile.group)) throw new Error("এই রঙের সব সম্পত্তির মালিক হতে হবে");
    if (state.houses >= 5) throw new Error("সর্বোচ্চ হোটেল লেভেলে পৌঁছেছে");
    if (player.money < tile.houseCost) throw new Error("পর্যাপ্ত টাকা নেই");
    player.money -= tile.houseCost;
    state.houses += 1;
    this.pushLog(`${player.name} "${tile.name}" তে ${state.houses <= 4 ? "একটি বাড়ি" : "হোটেল"} তৈরি করলেন।`);
  }

  sellHouse(playerId, tileId) {
    const tile = tileById(tileId);
    const state = this.propertyState[tileId];
    const player = this.getPlayer(playerId);
    if (!state || state.ownerId !== playerId) throw new Error("এই সম্পত্তি আপনার নয়");
    if (state.houses <= 0) throw new Error("এখানে কোনো বাড়ি নেই");
    state.houses -= 1;
    player.money += Math.floor(tile.houseCost / 2);
    this.pushLog(`${player.name} "${tile.name}" থেকে একটি বাড়ি বিক্রি করলেন।`);
  }

  // ---- trading -------------------------------------------------------------
  proposeTrade(fromId, toId, offer) {
    // offer: { fromCash, toCash, fromProperties: [tileId], toProperties: [tileId] }
    this.pendingTrade = { id: nanoid(6), fromId, toId, offer, status: "pending" };
    return this.pendingTrade;
  }

  respondTrade(playerId, accept) {
    if (!this.pendingTrade || this.pendingTrade.toId !== playerId) throw new Error("কোনো প্রস্তাব নেই");
    const { fromId, toId, offer } = this.pendingTrade;
    if (accept) {
      const fromP = this.getPlayer(fromId);
      const toP = this.getPlayer(toId);
      if (fromP.money < offer.fromCash) throw new Error("প্রস্তাবকারীর পর্যাপ্ত টাকা নেই");
      if (toP.money < offer.toCash) throw new Error("আপনার পর্যাপ্ত টাকা নেই");
      fromP.money -= offer.fromCash;
      toP.money += offer.fromCash;
      toP.money -= offer.toCash;
      fromP.money += offer.toCash;
      (offer.fromProperties || []).forEach((tid) => {
        fromP.properties = fromP.properties.filter((x) => x !== tid);
        toP.properties.push(tid);
        this.propertyState[tid].ownerId = toId;
      });
      (offer.toProperties || []).forEach((tid) => {
        toP.properties = toP.properties.filter((x) => x !== tid);
        fromP.properties.push(tid);
        this.propertyState[tid].ownerId = fromId;
      });
      this.pushLog(`${fromP.name} ও ${toP.name} এর মধ্যে ট্রেড সম্পন্ন হলো।`);
    } else {
      this.pushLog("ট্রেড প্রস্তাব প্রত্যাখ্যাত হয়েছে।");
    }
    this.pendingTrade = null;
  }

  // ---- bankruptcy ------------------------------------------------------------
  checkBankruptcy(player, creditorOrNull) {
    if (player.money >= 0) return false;
    // Can they cover it by mortgaging/selling houses? We let the client attempt
    // those actions first; if money is still negative when they explicitly
    // declare bankruptcy (or have no assets left), we finalize it here.
    const canRaise = player.properties.some((tid) => {
      const st = this.propertyState[tid];
      return st && (!st.mortgaged || st.houses > 0);
    });
    if (canRaise) {
      this.turn.pendingAction = { type: "mustRaiseFunds", playerId: player.id, deficit: -player.money, creditorId: creditorOrNull ? creditorOrNull.id : null };
      return false;
    }
    this.declareBankrupt(player, creditorOrNull);
    return true;
  }

  declareBankrupt(player, creditorOrNull) {
    player.bankrupt = true;
    player.properties.forEach((tid) => {
      const st = this.propertyState[tid];
      if (!st) return;
      if (creditorOrNull) {
        st.ownerId = creditorOrNull.id;
        st.houses = 0;
        creditorOrNull.properties.push(tid);
      } else {
        delete this.propertyState[tid];
      }
    });
    player.properties = [];
    this.pushLog(`${player.name} দেউলিয়া ঘোষিত হলেন এবং খেলা থেকে বাদ পড়লেন।`);
    this.turn.pendingAction = null;
    this.turn.canEndTurn = true;

    const remaining = this.activePlayers();
    if (remaining.length === 1) {
      this.finished = true;
      this.winner = remaining[0].id;
      this.pushLog(`🎉 ${remaining[0].name} খেলায় জয়ী হলেন!`);
    }
  }

  // ---- turn management ----------------------------------------------------
  endTurn(playerId) {
    const player = this.currentPlayer();
    if (!player || player.id !== playerId) throw new Error("এখন আপনার পালা নয়");
    if (this.turn.pendingAction) throw new Error("আগের সিদ্ধান্ত সম্পন্ন করুন");
    if (this.turn.awaitingReRoll) throw new Error("আপনার আবার ছক্কা চালার সুযোগ আছে");

    this.turn = { hasRolled: false, doublesCount: 0, lastDice: null, pendingAction: null };
    let next = this.currentPlayerIndex;
    do {
      next = (next + 1) % this.players.length;
    } while (this.players[next].bankrupt && next !== this.currentPlayerIndex);
    this.currentPlayerIndex = next;
  }

  // ---- serialization --------------------------------------------------------
  getPublicState() {
    return {
      code: this.code,
      hostPlayerId: this.hostPlayerId,
      maxPlayers: this.maxPlayers,
      started: this.started,
      finished: this.finished,
      winner: this.winner,
      players: this.players,
      propertyState: this.propertyState,
      currentPlayerIndex: this.currentPlayerIndex,
      turn: this.turn,
      auction: this.auction,
      pendingTrade: this.pendingTrade,
      log: this.log.slice(-40),
      chat: this.chatLog.slice(-100)
    };
  }
}

module.exports = { Room, tileById, propertyGroupTiles };
