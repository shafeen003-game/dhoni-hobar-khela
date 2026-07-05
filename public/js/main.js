// ============================================================================
// CLIENT APP — ধনী হবার মজার খেলা
// ============================================================================
(function () {
  "use strict";

  const TILE_ICONS = {
    start: "🏁", jail: "🚔", freeParking: "🅿️", goToJail: "👮",
    chance: "❓", luck: "🍀", tax: "💰", railway: "🚉"
  };
  const TOKEN_EMOJI = { car: "🚗", boat: "⛵", hat: "🎩", dog: "🐕", plane: "✈️", camera: "📷" };
  const PLAYER_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22"];

  const TILES = BOARD_DATA.TILES;
  const GROUP_COLORS = BOARD_DATA.GROUP_COLORS;
  const tileById = (id) => TILES[id];

  const socket = io();

  // ---- persistent client state ---------------------------------------------
  let session = JSON.parse(localStorage.getItem("dhoni_session") || "null");
  let myPlayerId = session ? session.playerId : null;
  let currentRoomCode = session ? session.roomCode : null;
  let pendingMode = null; // 'create' | 'join'
  let selectedToken = null;
  let selectedColor = null;
  let soundOn = true;
  let latestState = null;
  let seenTradeId = null;
  let boardBuilt = false;

  function saveSession(roomCode, playerId) {
    session = { roomCode, playerId };
    localStorage.setItem("dhoni_session", JSON.stringify(session));
  }
  function clearSession() {
    session = null;
    localStorage.removeItem("dhoni_session");
  }

  // ---- helpers ---------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function showScreen(name) {
    $all(".screen").forEach((s) => s.classList.remove("active"));
    $(`#screen-${name}`).classList.add("active");
  }
  function toast(msg) {
    const stack = $("#toast-stack");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  function money(n) { return "৳" + Math.round(n).toLocaleString("bn-BD"); }
  function myPlayer() {
    return latestState ? latestState.players.find((p) => p.id === myPlayerId) : null;
  }
  function isMyTurn() {
    if (!latestState) return false;
    const cur = latestState.players[latestState.currentPlayerIndex];
    return cur && cur.id === myPlayerId;
  }
  function beep(freq, dur) {
    freq = freq || 440; dur = dur || 0.08;
    if (!soundOn) return;
    try {
      const ctx = beep._ctx || (beep._ctx = new (window.AudioContext || window.webkitAudioContext)());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* audio not available */ }
  }

  // ============================================================================
  // HOME SCREEN
  // ============================================================================
  function renderPickers() {
    const tokenPicker = $("#token-picker");
    tokenPicker.innerHTML = "";
    BOARD_DATA.TOKENS.forEach((tok) => {
      const chip = document.createElement("div");
      chip.className = "token-chip" + (selectedToken === tok ? " selected" : "");
      chip.textContent = TOKEN_EMOJI[tok];
      chip.title = tok;
      chip.addEventListener("click", () => { selectedToken = tok; renderPickers(); });
      tokenPicker.appendChild(chip);
    });
    const colorPicker = $("#color-picker");
    colorPicker.innerHTML = "";
    PLAYER_COLORS.forEach((c) => {
      const chip = document.createElement("div");
      chip.className = "color-chip" + (selectedColor === c ? " selected" : "");
      chip.style.background = c;
      chip.addEventListener("click", () => { selectedColor = c; renderPickers(); });
      colorPicker.appendChild(chip);
    });
  }

  $("#btn-create").addEventListener("click", () => {
    pendingMode = "create";
    selectedToken = BOARD_DATA.TOKENS[0];
    selectedColor = PLAYER_COLORS[0];
    $("#setup-title").textContent = "রুম তৈরি করুন";
    $("#join-code-row").classList.add("hidden");
    renderPickers();
    $("#panel-setup").classList.remove("hidden");
  });

  $("#btn-join").addEventListener("click", () => {
    pendingMode = "join";
    selectedToken = BOARD_DATA.TOKENS[0];
    selectedColor = PLAYER_COLORS[0];
    $("#setup-title").textContent = "রুমে যোগ দিন";
    $("#join-code-row").classList.remove("hidden");
    renderPickers();
    $("#panel-setup").classList.remove("hidden");
  });

  $("#btn-setup-cancel").addEventListener("click", () => $("#panel-setup").classList.add("hidden"));

  $("#btn-setup-confirm").addEventListener("click", () => {
    const name = $("#input-name").value.trim() || "খেলোয়াড়";
    if (!selectedToken) return toast("একটি টোকেন বেছে নিন");
    const payload = { name, avatar: TOKEN_EMOJI[selectedToken], token: selectedToken, color: selectedColor };

    if (pendingMode === "create") {
      socket.emit("createRoom", payload, (res) => {
        if (!res || !res.ok) return toast("রুম তৈরি করা যায়নি");
        myPlayerId = res.playerId;
        currentRoomCode = res.roomCode;
        saveSession(res.roomCode, res.playerId);
        $("#panel-setup").classList.add("hidden");
        showScreen("lobby");
      });
    } else {
      const code = $("#input-room-code").value.trim().toUpperCase();
      if (!code) return toast("রুম কোড লিখুন");
      socket.emit("joinRoom", { roomCode: code, ...payload }, (res) => {
        if (!res || !res.ok) return toast((res && res.error) || "যোগ দেওয়া যায়নি");
        myPlayerId = res.playerId;
        currentRoomCode = res.roomCode;
        saveSession(res.roomCode, res.playerId);
        $("#panel-setup").classList.add("hidden");
        showScreen("lobby");
      });
    }
  });

  $("#btn-howtoplay").addEventListener("click", () => $("#panel-howto").classList.remove("hidden"));
  $("#btn-howto-close").addEventListener("click", () => $("#panel-howto").classList.add("hidden"));
  $("#btn-sound").addEventListener("click", () => { soundOn = !soundOn; toast(soundOn ? "শব্দ চালু" : "শব্দ বন্ধ"); });
  $("#btn-toggle-sound-g").addEventListener("click", () => { soundOn = !soundOn; toast(soundOn ? "শব্দ চালু" : "শব্দ বন্ধ"); });
  function toggleDark() { document.body.classList.toggle("light-theme"); }
  $("#btn-darkmode").addEventListener("click", toggleDark);
  $("#btn-toggle-dark-g").addEventListener("click", toggleDark);

  $("#btn-leave-lobby").addEventListener("click", () => {
    clearSession();
    location.reload();
  });
  $("#btn-back-home").addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  socket.on("errorMsg", (msg) => toast(msg));

  // attempt auto-rejoin on load
  socket.on("connect", () => {
    if (session) {
      socket.emit("rejoinRoom", session, (res) => {
        if (res && res.ok) {
          myPlayerId = session.playerId;
          currentRoomCode = session.roomCode;
        } else {
          clearSession();
          showScreen("home");
        }
      });
    }
  });

  // ============================================================================
  // LOBBY SCREEN
  // ============================================================================
  $("#btn-copy-code").addEventListener("click", () => {
    navigator.clipboard && navigator.clipboard.writeText(currentRoomCode);
    toast("কোড কপি হয়েছে");
  });
  $("#btn-ready").addEventListener("click", () => socket.emit("toggleReady"));
  $("#select-max-players").addEventListener("change", (e) => socket.emit("setMaxPlayers", Number(e.target.value)));
  $("#btn-start-game").addEventListener("click", () => socket.emit("startGame"));

  function renderLobby(state) {
    $("#lobby-room-code").textContent = state.code;
    const isHost = state.hostPlayerId === myPlayerId;
    $("#host-settings").style.display = isHost ? "flex" : "none";
    $("#select-max-players").value = state.maxPlayers;
    $("#btn-start-game").classList.toggle("hidden", !(isHost && state.allReadyComputed));

    const wrap = $("#lobby-players");
    wrap.innerHTML = "";
    state.players.forEach((p) => {
      const card = document.createElement("div");
      card.className = "lobby-player-card" + (p.ready ? " is-ready" : "");
      card.innerHTML =
        '<div class="lobby-player-token">' + (TOKEN_EMOJI[p.token] || "🙂") + '</div>' +
        '<div class="lobby-player-name" style="color:' + p.color + '">' + escapeHtml(p.name) + (p.id === state.hostPlayerId ? " 👑" : "") + '</div>' +
        '<div class="lobby-player-status">' + (p.ready ? "প্রস্তুত ✅" : "অপেক্ষমাণ…") + (p.connected ? "" : " (সংযোগ বিচ্ছিন্ন)") + '</div>';
      wrap.appendChild(card);
    });

    const me = state.players.find((p) => p.id === myPlayerId);
    $("#btn-ready").textContent = me && me.ready ? "❎ প্রস্তুত বাতিল করুন" : "✅ প্রস্তুত";
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ============================================================================
  // GAME SCREEN — board building (static grid) + dynamic updates
  // ============================================================================
  function gridPos(id) {
    if (id <= 10) return { row: 11, col: 11 - id };
    if (id <= 20) return { row: 21 - id, col: 1 };
    if (id <= 30) return { row: 1, col: id - 19 };
    return { row: id - 29, col: 11 };
  }

  function tileIcon(tile) {
    if (tile.type === "utility") return tile.name.indexOf("বিদ্যুৎ") !== -1 ? "💡" : "🚰";
    return TILE_ICONS[tile.type] || "";
  }

  function buildBoard() {
    const board = $("#board");
    board.innerHTML = "";
    TILES.forEach((tile) => {
      const pos = gridPos(tile.id);
      const div = document.createElement("div");
      const isCorner = ["start", "jail", "freeParking", "goToJail"].indexOf(tile.type) !== -1;
      div.className = "tile type-" + tile.type + (isCorner ? " corner" : "");
      div.style.gridRow = pos.row;
      div.style.gridColumn = pos.col;
      div.dataset.tileId = tile.id;

      let ownerBarColor = "transparent";
      if (tile.type === "property") ownerBarColor = GROUP_COLORS[tile.group];

      div.innerHTML =
        '<div class="tile-owner-bar" style="background:' + ownerBarColor + '" data-role="ownerbar"></div>' +
        '<div class="tile-icon">' + tileIcon(tile) + '</div>' +
        '<div class="tile-name">' + tile.name + '</div>' +
        (tile.price ? '<div class="tile-price">৳' + tile.price + '</div>' : "") +
        '<div class="tile-houses" data-role="houses"></div>' +
        '<div class="tokens-on-tile" data-role="tokens"></div>';
      div.addEventListener("click", () => openTileInfo(tile.id));
      board.appendChild(div);
    });

    const center = document.createElement("div");
    center.className = "board-center";
    center.innerHTML = "<h2>ধনী হবার<br/>মজার খেলা</h2>";
    board.appendChild(center);
    boardBuilt = true;
  }

  function openTileInfo(tileId) {
    if (!latestState) return;
    const tile = tileById(tileId);
    const state = latestState.propertyState[tileId];
    if (!state) return toast(tile.name + ": মালিকহীন");
    const owner = latestState.players.find((p) => p.id === state.ownerId);
    toast(tile.name + " — মালিক: " + (owner ? owner.name : "ব্যাংক") + (state.mortgaged ? " (বন্ধক)" : ""));
  }

  function updateBoard(state) {
    if (!boardBuilt) buildBoard();
    TILES.forEach((tile) => {
      const el = document.querySelector('.tile[data-tile-id="' + tile.id + '"]');
      if (!el) return;
      const pState = state.propertyState[tile.id];
      const ownerBar = el.querySelector('[data-role="ownerbar"]');
      const housesEl = el.querySelector('[data-role="houses"]');
      housesEl.innerHTML = "";
      let mortgagedOverlay = el.querySelector(".tile-mortgaged");

      if (pState) {
        const owner = state.players.find((p) => p.id === pState.ownerId);
        if (owner) ownerBar.style.background = owner.color;
        ownerBar.style.height = "6px";
        if (pState.houses > 0 && pState.houses < 5) {
          for (let i = 0; i < pState.houses; i++) {
            const h = document.createElement("div");
            h.className = "tile-house";
            housesEl.appendChild(h);
          }
        } else if (pState.houses === 5) {
          const h = document.createElement("div");
          h.className = "tile-hotel";
          housesEl.appendChild(h);
        }
        if (pState.mortgaged && !mortgagedOverlay) {
          mortgagedOverlay = document.createElement("div");
          mortgagedOverlay.className = "tile-mortgaged";
          mortgagedOverlay.textContent = "🔒";
          el.appendChild(mortgagedOverlay);
        } else if (!pState.mortgaged && mortgagedOverlay) {
          mortgagedOverlay.remove();
        }
      } else {
        if (tile.type === "property") ownerBar.style.background = GROUP_COLORS[tile.group];
        else ownerBar.style.background = "transparent";
        if (mortgagedOverlay) mortgagedOverlay.remove();
      }

      const tokensEl = el.querySelector('[data-role="tokens"]');
      tokensEl.innerHTML = "";
      state.players.filter((p) => p.position === tile.id && !p.bankrupt).forEach((p) => {
        const av = document.createElement("div");
        av.className = "token-avatar";
        av.style.borderColor = p.color;
        av.textContent = TOKEN_EMOJI[p.token] || "🙂";
        av.title = p.name;
        tokensEl.appendChild(av);
      });
    });
  }

  // ---- side panel: players / log / chat --------------------------------------
  $all(".side-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $all(".side-tab").forEach((t) => t.classList.remove("active"));
      $all(".side-tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      $("#tab-" + tab.dataset.tab).classList.add("active");
    });
  });
  $("#btn-toggle-chat").addEventListener("click", () => {
    const panel = $("#side-panel");
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  });

  function renderPlayerCards(state) {
    const wrap = $("#player-cards");
    wrap.innerHTML = "";
    state.players.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "player-card" + (idx === state.currentPlayerIndex ? " current-turn" : "") + (p.bankrupt ? " is-bankrupt" : "");
      card.innerHTML =
        '<div class="player-avatar-token">' + (TOKEN_EMOJI[p.token] || "🙂") + '</div>' +
        '<div style="flex:1">' +
        '<div class="player-card-name" style="color:' + p.color + '">' + escapeHtml(p.name) + (p.id === myPlayerId ? " (আপনি)" : "") + '</div>' +
        '<div class="player-card-money">' + money(p.money) + '</div>' +
        '<div class="player-card-badges">' +
        (p.inJail ? '<span class="badge badge-jail">জেলে</span>' : "") +
        (p.bankrupt ? '<span class="badge">দেউলিয়া</span>' : "") +
        (!p.connected ? '<span class="badge">অফলাইন</span>' : "") +
        (p.getOutOfJailCards > 0 ? '<span class="badge">🎫 x' + p.getOutOfJailCards + '</span>' : "") +
        '</div></div>';
      wrap.appendChild(card);
    });
  }

  function renderLog(state) {
    const el = $("#game-log");
    el.innerHTML = state.log.map((l) => '<div class="log-line">' + escapeHtml(l.text) + '</div>').join("");
    el.scrollTop = el.scrollHeight;
  }
  function renderChat(state) {
    const el = $("#chat-log");
    el.innerHTML = state.chat.map((c) => '<div class="chat-line"><strong>' + escapeHtml(c.name) + ':</strong> ' + escapeHtml(c.text) + '</div>').join("");
    el.scrollTop = el.scrollHeight;
  }
  $("#btn-chat-send").addEventListener("click", sendChat);
  $("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  function sendChat() {
    const input = $("#chat-input");
    if (!input.value.trim()) return;
    socket.emit("sendChat", input.value.trim());
    input.value = "";
  }

  // ---- turn indicator + controls ---------------------------------------------
  function renderTurnBar(state) {
    const cur = state.players[state.currentPlayerIndex];
    $("#turn-indicator").textContent = cur ? "🎯 এখন পালা: " + cur.name + (cur.id === myPlayerId ? " (আপনি)" : "") : "—";

    const myTurn = isMyTurn();
    const me = myPlayer();

    $("#btn-roll").disabled = !myTurn || (state.turn.hasRolled && !state.turn.awaitingReRoll) || !!state.turn.pendingAction || (me && me.inJail);
    $("#btn-end-turn").disabled = !myTurn || state.turn.awaitingReRoll || !!state.turn.pendingAction || !state.turn.hasRolled;
    $("#btn-trade").disabled = !state.started || state.finished;
  }

  $("#btn-roll").addEventListener("click", () => socket.emit("rollDice"));
  $("#btn-end-turn").addEventListener("click", () => socket.emit("endTurn"));

  const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  function animateDice(d1, d2) {
    const disp = $("#dice-display");
    disp.classList.remove("hidden");
    $("#die-1").textContent = DICE_FACES[d1];
    $("#die-2").textContent = DICE_FACES[d2];
    $("#die-1").style.animation = "none"; void $("#die-1").offsetHeight; $("#die-1").style.animation = "";
    $("#die-2").style.animation = "none"; void $("#die-2").offsetHeight; $("#die-2").style.animation = "";
    beep(300 + d1 * 40);
    clearTimeout(animateDice._t);
    animateDice._t = setTimeout(() => disp.classList.add("hidden"), 2500);
  }

  let lastDiceKey = null;
  function checkDiceAnimation(state) {
    if (state.turn.lastDice) {
      const key = state.turn.lastDice.join(",") + state.currentPlayerIndex + state.turn.doublesCount;
      if (key !== lastDiceKey) {
        lastDiceKey = key;
        animateDice(state.turn.lastDice[0], state.turn.lastDice[1]);
      }
    }
  }

  // ============================================================================
  // MODALS — buy / auction / jail / bankrupt / trade
  // ============================================================================
  function updateModals(state) {
    const me = myPlayer();

    const buyAction = state.turn.pendingAction && state.turn.pendingAction.type === "buyDecision" ? state.turn.pendingAction : null;
    if (buyAction && buyAction.playerId === myPlayerId) {
      const tile = tileById(buyAction.tileId);
      $("#buy-tile-name").textContent = tile.name;
      $("#buy-tile-info").textContent = "মূল্য: " + money(tile.price) + " — কিনবেন, নাকি নিলামে তুলবেন?";
      $("#modal-buy").classList.remove("hidden");
      $("#modal-buy").dataset.tileId = tile.id;
    } else {
      $("#modal-buy").classList.add("hidden");
    }

    if (state.auction) {
      $("#modal-auction").classList.remove("hidden");
      const tile = tileById(state.auction.tileId);
      $("#auction-tile-name").textContent = tile.name;
      $("#auction-highest").textContent = money(Math.max(0, state.auction.highestBid));
      const bidder = state.players.find((p) => p.id === state.auction.highestBidderId);
      $("#auction-highest-bidder").textContent = bidder ? bidder.name : "কেউ না";
      const secondsLeft = Math.max(0, Math.ceil((state.auction.endsAt - Date.now()) / 1000));
      $("#auction-timer").textContent = secondsLeft;
      const iAmOut = state.auction.biddersLeft.indexOf(myPlayerId) === -1;
      $("#btn-auction-bid").disabled = iAmOut;
      $("#btn-auction-pass").disabled = iAmOut;
    } else {
      $("#modal-auction").classList.add("hidden");
    }

    if (me && me.inJail && isMyTurn() && !state.turn.hasRolled) {
      $("#modal-jail").classList.remove("hidden");
      $("#btn-jail-card").disabled = me.getOutOfJailCards < 1;
      $("#btn-jail-pay").disabled = me.money < 50;
    } else {
      $("#modal-jail").classList.add("hidden");
    }

    const raiseAction = state.turn.pendingAction && state.turn.pendingAction.type === "mustRaiseFunds" ? state.turn.pendingAction : null;
    if (raiseAction && raiseAction.playerId === myPlayerId) {
      $("#bankrupt-info").textContent = "আপনার ৳" + raiseAction.deficit + " ঘাটতি আছে। সম্পত্তি বন্ধক রাখুন বা বাড়ি বিক্রি করুন, অথবা দেউলিয়া ঘোষণা করুন।";
      $("#modal-bankrupt").classList.remove("hidden");
    } else {
      $("#modal-bankrupt").classList.add("hidden");
    }

    if (state.finished && state.winner) {
      const w = state.players.find((p) => p.id === state.winner);
      $("#winner-name").textContent = w ? w.name : "?";
      $("#modal-winner").classList.remove("hidden");
    }

    if (state.pendingTrade && state.pendingTrade.toId === myPlayerId && state.pendingTrade.id !== seenTradeId) {
      seenTradeId = state.pendingTrade.id;
      showIncomingTrade(state.pendingTrade, state);
    }
    if (!state.pendingTrade) {
      $("#modal-trade-incoming").classList.add("hidden");
      seenTradeId = null;
    }
  }

  $("#btn-confirm-buy").addEventListener("click", () => socket.emit("buyProperty", Number($("#modal-buy").dataset.tileId)));
  $("#btn-decline-buy").addEventListener("click", () => socket.emit("declineProperty", Number($("#modal-buy").dataset.tileId)));
  $("#btn-auction-bid").addEventListener("click", () => {
    const val = Number($("#auction-bid-input").value);
    if (!val || val < 1) return toast("সঠিক পরিমাণ লিখুন");
    socket.emit("placeBid", val);
    $("#auction-bid-input").value = "";
  });
  $("#btn-auction-pass").addEventListener("click", () => socket.emit("passAuction"));
  $("#btn-jail-pay").addEventListener("click", () => socket.emit("payJailFine"));
  $("#btn-jail-card").addEventListener("click", () => socket.emit("useJailCard"));
  $("#btn-jail-roll").addEventListener("click", () => socket.emit("rollDice"));
  $("#btn-declare-bankrupt").addEventListener("click", () => socket.emit("declareBankrupt"));
  $("#btn-open-properties-from-bankrupt").addEventListener("click", () => openPropertiesModal());

  // ---- my properties modal --------------------------------------------------
  $("#btn-my-properties").addEventListener("click", openPropertiesModal);
  $("#btn-close-properties").addEventListener("click", () => $("#modal-properties").classList.add("hidden"));

  function openPropertiesModal() {
    if (!latestState) return;
    const me = myPlayer();
    if (!me) return;
    const list = $("#my-properties-list");
    list.innerHTML = "";
    if (!me.properties.length) list.innerHTML = "<p>আপনার কোনো সম্পত্তি নেই।</p>";
    me.properties.forEach((tid) => {
      const tile = tileById(tid);
      const pState = latestState.propertyState[tid];
      const row = document.createElement("div");
      row.className = "property-row";
      const groupComplete = tile.type === "property" && BOARD_DATA.groupTileIds(tile.group).every(
        (id) => latestState.propertyState[id] && latestState.propertyState[id].ownerId === me.id
      );
      row.innerHTML =
        '<div><div class="property-row-name">' + tile.name + " " + (pState.mortgaged ? "🔒" : "") + '</div>' +
        '<div class="property-row-sub">' + (pState.houses === 5 ? "হোটেল" : pState.houses > 0 ? pState.houses + "টি বাড়ি" : "খালি জমি") + '</div></div>' +
        '<div class="property-row-actions"></div>';
      const actions = row.querySelector(".property-row-actions");

      if (!pState.mortgaged) {
        const mbtn = document.createElement("button");
        mbtn.className = "btn btn-ghost btn-sm";
        mbtn.textContent = "বন্ধক রাখুন";
        mbtn.disabled = pState.houses > 0;
        mbtn.addEventListener("click", () => socket.emit("mortgage", tid));
        actions.appendChild(mbtn);
      } else {
        const ubtn = document.createElement("button");
        ubtn.className = "btn btn-ghost btn-sm";
        ubtn.textContent = "বন্ধক মুক্ত করুন";
        ubtn.addEventListener("click", () => socket.emit("unmortgage", tid));
        actions.appendChild(ubtn);
      }

      if (tile.type === "property" && groupComplete && !pState.mortgaged) {
        if (pState.houses < 5) {
          const bbtn = document.createElement("button");
          bbtn.className = "btn btn-secondary btn-sm";
          bbtn.textContent = pState.houses === 4 ? "হোটেল বানান" : "বাড়ি বানান";
          bbtn.addEventListener("click", () => socket.emit("buildHouse", tid));
          actions.appendChild(bbtn);
        }
        if (pState.houses > 0) {
          const sbtn = document.createElement("button");
          sbtn.className = "btn btn-ghost btn-sm";
          sbtn.textContent = "বাড়ি বিক্রি করুন";
          sbtn.addEventListener("click", () => socket.emit("sellHouse", tid));
          actions.appendChild(sbtn);
        }
      }
      list.appendChild(row);
    });
    $("#modal-properties").classList.remove("hidden");
  }

  // ---- trade modal -------------------------------------------------------------
  $("#btn-trade").addEventListener("click", openTradeModal);
  $("#btn-trade-cancel").addEventListener("click", () => $("#modal-trade").classList.add("hidden"));

  function openTradeModal() {
    if (!latestState) return;
    const others = latestState.players.filter((p) => p.id !== myPlayerId && !p.bankrupt);
    if (!others.length) return toast("ট্রেড করার জন্য অন্য খেলোয়াড় নেই");
    const targetSel = $("#trade-target");
    targetSel.innerHTML = others.map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join("");
    renderTradeProps();
    targetSel.onchange = renderTradeProps;
    $("#trade-my-cash").value = 0;
    $("#trade-their-cash").value = 0;
    $("#modal-trade").classList.remove("hidden");
  }

  function renderTradeProps() {
    const me = myPlayer();
    const targetId = $("#trade-target").value;
    const target = latestState.players.find((p) => p.id === targetId);
    const myBox = $("#trade-my-properties");
    const theirBox = $("#trade-their-properties");
    myBox.innerHTML = (me.properties || []).map((tid) =>
      '<label class="trade-prop-item"><input type="checkbox" value="' + tid + '" /> ' + tileById(tid).name + '</label>'
    ).join("") || "<em>নেই</em>";
    theirBox.innerHTML = (target ? target.properties : []).map((tid) =>
      '<label class="trade-prop-item"><input type="checkbox" value="' + tid + '" /> ' + tileById(tid).name + '</label>'
    ).join("") || "<em>নেই</em>";
  }

  $("#btn-trade-send").addEventListener("click", () => {
    const toId = $("#trade-target").value;
    const fromProperties = $all("#trade-my-properties input:checked").map((i) => Number(i.value));
    const toProperties = $all("#trade-their-properties input:checked").map((i) => Number(i.value));
    const offer = {
      fromCash: Number($("#trade-my-cash").value) || 0,
      toCash: Number($("#trade-their-cash").value) || 0,
      fromProperties: fromProperties, toProperties: toProperties
    };
    socket.emit("proposeTrade", { toId: toId, offer: offer });
    $("#modal-trade").classList.add("hidden");
    toast("ট্রেড প্রস্তাব পাঠানো হয়েছে");
  });

  function showIncomingTrade(trade, state) {
    const from = state.players.find((p) => p.id === trade.fromId);
    const detail = $("#trade-incoming-detail");
    const propNames = (ids) => ids.length ? ids.map((id) => tileById(id).name).join(", ") : "কিছু না";
    detail.innerHTML =
      '<p><strong>' + escapeHtml(from ? from.name : "?") + '</strong> আপনাকে একটি ট্রেড প্রস্তাব দিয়েছেন:</p>' +
      '<p>আপনি দেবেন: ' + money(trade.offer.toCash) + ' + ' + propNames(trade.offer.toProperties) + '</p>' +
      '<p>আপনি পাবেন: ' + money(trade.offer.fromCash) + ' + ' + propNames(trade.offer.fromProperties) + '</p>';
    $("#modal-trade-incoming").classList.remove("hidden");
  }
  $("#btn-trade-accept").addEventListener("click", () => { socket.emit("respondTrade", true); $("#modal-trade-incoming").classList.add("hidden"); });
  $("#btn-trade-reject").addEventListener("click", () => { socket.emit("respondTrade", false); $("#modal-trade-incoming").classList.add("hidden"); });

  // ============================================================================
  // MAIN STATE HANDLER
  // ============================================================================
  socket.on("state", (state) => {
    state.allReadyComputed = state.players.length >= 2 && state.players.every((p) => p.ready);
    latestState = state;

    if (!state.started) {
      showScreen("lobby");
      renderLobby(state);
      return;
    }

    showScreen("game");
    updateBoard(state);
    renderPlayerCards(state);
    renderLog(state);
    renderChat(state);
    renderTurnBar(state);
    checkDiceAnimation(state);
    updateModals(state);
  });

  setInterval(() => {
    if (latestState && latestState.auction) updateModals(latestState);
  }, 500);

  // default screen
  showScreen("home");
})();
