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
  let myPlayerId = session ? session.playerId : null; // the seat that created/joined this browser tab
  let currentRoomCode = session ? session.roomCode : null;
  let pendingMode = null; // 'create' | 'join' | 'addLocal'
  let selectedToken = null;
  let selectedColor = null;
  let soundOn = true;
  let latestState = null;
  let seenTradeId = null;
  let boardBuilt = false;

  // ---- pass-and-play (multiple players on one phone/device) -----------------
  // localSeatIds: every seat this device is allowed to act as, in this room.
  // activeSeatId: which of those seats the UI currently shows / acts as.
  let localSeatIds = [];
  let activeSeatId = myPlayerId;
  let lastAutoSwitchTurnKey = null;

  function localSeatsKey(roomCode) { return "dhoni_localseats_" + roomCode; }
  function loadLocalSeats(roomCode) {
    try {
      const raw = localStorage.getItem(localSeatsKey(roomCode));
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveLocalSeats(roomCode) {
    localStorage.setItem(localSeatsKey(roomCode), JSON.stringify(localSeatIds));
  }
  function addLocalSeatId(roomCode, playerId) {
    if (localSeatIds.indexOf(playerId) === -1) localSeatIds.push(playerId);
    saveLocalSeats(roomCode);
  }

  function saveSession(roomCode, playerId) {
    session = { roomCode, playerId };
    localStorage.setItem("dhoni_session", JSON.stringify(session));
  }
  function clearSession() {
    if (currentRoomCode) localStorage.removeItem(localSeatsKey(currentRoomCode));
    session = null;
    localSeatIds = [];
    activeSeatId = null;
    localStorage.removeItem("dhoni_session");
  }

  // Every outgoing game-action event is tagged with which local seat is
  // performing it, so one device can control several players and pass
  // itself around the table.
  function emitAs(event, payload, cb) {
    const body = Object.assign({}, payload || {}, { __asPlayerId: activeSeatId });
    socket.emit(event, body, cb);
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
  function seatPlayer(id) {
    return latestState ? latestState.players.find((p) => p.id === id) : null;
  }
  function myPlayer() {
    return seatPlayer(activeSeatId);
  }
  function isMyTurn() {
    if (!latestState) return false;
    const cur = latestState.players[latestState.currentPlayerIndex];
    return cur && cur.id === activeSeatId;
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
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
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

  function openSetupPanel(mode) {
    pendingMode = mode;
    selectedToken = BOARD_DATA.TOKENS[0];
    selectedColor = PLAYER_COLORS[0];
    $("#input-name").value = "";
    if (mode === "create") {
      $("#setup-title").textContent = "রুম তৈরি করুন";
      $("#join-code-row").classList.add("hidden");
    } else if (mode === "join") {
      $("#setup-title").textContent = "রুমে যোগ দিন";
      $("#join-code-row").classList.remove("hidden");
    } else {
      $("#setup-title").textContent = "এই ডিভাইসে আরেকজন খেলোয়াড় যোগ করুন";
      $("#join-code-row").classList.add("hidden");
    }
    renderPickers();
    $("#panel-setup").classList.remove("hidden");
  }

  $("#btn-create").addEventListener("click", () => openSetupPanel("create"));
  $("#btn-join").addEventListener("click", () => openSetupPanel("join"));

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
        localSeatIds = [res.playerId];
        activeSeatId = res.playerId;
        saveSession(res.roomCode, res.playerId);
        saveLocalSeats(res.roomCode);
        $("#panel-setup").classList.add("hidden");
        showScreen("lobby");
      });
    } else if (pendingMode === "join") {
      const code = $("#input-room-code").value.trim().toUpperCase();
      if (!code) return toast("রুম কোড লিখুন");
      socket.emit("joinRoom", { roomCode: code, ...payload }, (res) => {
        if (!res || !res.ok) return toast((res && res.error) || "যোগ দেওয়া যায়নি");
        myPlayerId = res.playerId;
        currentRoomCode = res.roomCode;
        localSeatIds = [res.playerId];
        activeSeatId = res.playerId;
        saveSession(res.roomCode, res.playerId);
        saveLocalSeats(res.roomCode);
        $("#panel-setup").classList.add("hidden");
        showScreen("lobby");
      });
    } else {
      // addLocal — another player joins on this same device/phone
      socket.emit("addLocalSeat", payload, (res) => {
        if (!res || !res.ok) return toast((res && res.error) || "যোগ করা যায়নি");
        addLocalSeatId(currentRoomCode, res.playerId);
        activeSeatId = res.playerId;
        $("#panel-setup").classList.add("hidden");
        toast("✅ " + name + " এই ডিভাইসে যোগ হলেন — এখন তিনি প্রস্তুত চাপতে পারেন");
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

  // attempt auto-rejoin on load (re-claims every locally-controlled seat too)
  socket.on("connect", () => {
    if (session) {
      localSeatIds = loadLocalSeats(session.roomCode);
      if (localSeatIds.indexOf(session.playerId) === -1) localSeatIds.unshift(session.playerId);
      const extraPlayerIds = localSeatIds.filter((id) => id !== session.playerId);
      socket.emit("rejoinRoom", { roomCode: session.roomCode, playerId: session.playerId, extraPlayerIds }, (res) => {
        if (res && res.ok) {
          myPlayerId = session.playerId;
          currentRoomCode = session.roomCode;
          activeSeatId = session.playerId;
          saveLocalSeats(currentRoomCode);
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
  $("#btn-ready").addEventListener("click", () => emitAs("toggleReady"));
  $("#btn-add-local-player").addEventListener("click", () => openSetupPanel("addLocal"));
  $("#select-max-players").addEventListener("change", (e) => socket.emit("setMaxPlayers", Number(e.target.value)));
  $("#btn-start-game").addEventListener("click", () => socket.emit("startGame"));

  function renderLobby(state) {
    $("#lobby-room-code").textContent = state.code;
    const isHost = state.hostPlayerId === myPlayerId;
    $("#host-settings").style.display = isHost ? "flex" : "none";
    $("#select-max-players").value = state.maxPlayers;
    $("#btn-start-game").classList.toggle("hidden", !(isHost && state.allReadyComputed));
    $("#btn-add-local-player").classList.toggle("hidden", state.players.length >= state.maxPlayers);

    const wrap = $("#lobby-players");
    wrap.innerHTML = "";
    state.players.forEach((p) => {
      const isLocalSeat = localSeatIds.indexOf(p.id) !== -1;
      const card = document.createElement("div");
      card.className = "lobby-player-card" + (p.ready ? " is-ready" : "") + (isLocalSeat ? " is-local-seat" : "");
      card.innerHTML =
        '<div class="lobby-player-token">' + (TOKEN_EMOJI[p.token] || "🙂") + '</div>' +
        '<div class="lobby-player-name" style="color:' + p.color + '">' + escapeHtml(p.name) + (p.id === state.hostPlayerId ? " 👑" : "") + '</div>' +
        '<div class="lobby-player-status">' + (p.ready ? "প্রস্তুত ✅" : "অপেক্ষমাণ…") + (p.connected ? "" : " (সংযোগ বিচ্ছিন্ন)") + '</div>' +
        (isLocalSeat ? '<button class="btn btn-ghost btn-sm lobby-mini-ready" data-pid="' + p.id + '">' + (p.ready ? "❎ বাতিল" : "✅ প্রস্তুত") + '</button>' : '<div class="lobby-badge-other">📱 অন্য ডিভাইস</div>');
      wrap.appendChild(card);
    });
    $all(".lobby-mini-ready").forEach((btn) => {
      btn.addEventListener("click", () => socket.emit("toggleReady", { __asPlayerId: btn.dataset.pid }));
    });

    const me = state.players.find((p) => p.id === activeSeatId);
    $("#btn-ready").textContent = me && me.ready ? "❎ প্রস্তুত বাতিল করুন (" + me.name + ")" : "✅ প্রস্তুত (" + (me ? me.name : "") + ")";
    $("#btn-ready").classList.toggle("hidden", localSeatIds.length > 1); // per-card buttons cover this when >1 local seat
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

  // ---- tile info modal: full detail so everyone can see who owns what ------
  function openTileInfo(tileId) {
    if (!latestState) return;
    const tile = tileById(tileId);
    const state = latestState.propertyState[tileId];
    const owner = state ? latestState.players.find((p) => p.id === state.ownerId) : null;
    const playersHere = latestState.players.filter((p) => p.position === tileId && !p.bankrupt);

    let html = '<h2>' + tileIcon(tile) + ' ' + escapeHtml(tile.name) + '</h2>';

    if (tile.type === "property") {
      html += '<p class="tile-info-group"><span class="tile-info-swatch" style="background:' + GROUP_COLORS[tile.group] + '"></span> রঙের গ্রুপ সম্পত্তি — মূল্য ' + money(tile.price) + '</p>';
      html += '<table class="tile-info-rent"><tr><th>অবস্থা</th><th>ভাড়া</th></tr>' +
        '<tr><td>খালি জমি</td><td>' + money(tile.rent[0]) + '</td></tr>' +
        '<tr><td>এক রঙের সব মালিকানা</td><td>' + money(tile.rent[0] * 2) + '</td></tr>' +
        [1, 2, 3, 4].map((h) => '<tr><td>' + h + 'টি বাড়ি</td><td>' + money(tile.rent[h]) + '</td></tr>').join("") +
        '<tr><td>হোটেল</td><td>' + money(tile.rent[5]) + '</td></tr>' +
        '</table>';
    } else if (tile.type === "railway") {
      html += '<p>মূল্য ' + money(tile.price) + ' — ভাড়া মালিকানাধীন স্টেশন সংখ্যার উপর নির্ভর করে: ' + tile.rent.map(money).join(" / ") + '</p>';
    } else if (tile.type === "utility") {
      html += '<p>মূল্য ' + money(tile.price) + ' — ভাড়া = ছক্কার যোগফল × ৪ (একটি মালিকানায়) বা ×১০ (দুটোই মালিকানায়)</p>';
    } else if (tile.type === "tax") {
      html += '<p>এখানে থামলে ব্যাংককে ' + money(tile.amount) + ' দিতে হয়।</p>';
    } else {
      html += '<p>এটি একটি বিশেষ ঘর — এখানে কেনাবেচা হয় না।</p>';
    }

    if (tile.type === "property" || tile.type === "railway" || tile.type === "utility") {
      if (owner) {
        html += '<p class="tile-info-owner" style="color:' + owner.color + '">মালিক: ' + (TOKEN_EMOJI[owner.token] || "") + ' ' + escapeHtml(owner.name) +
          (state.mortgaged ? " 🔒 (বন্ধক রাখা)" : "") + '</p>';
        if (state.houses > 0) {
          html += '<p>' + (state.houses === 5 ? "🏨 হোটেল আছে" : "🏠 " + state.houses + "টি বাড়ি আছে") + '</p>';
        }
      } else {
        html += '<p class="tile-info-owner">মালিক: ব্যাংক (এখনো কেনা হয়নি)</p>';
      }
    }

    if (playersHere.length) {
      html += '<p class="tile-info-here">এখন এখানে আছেন: ' + playersHere.map((p) => (TOKEN_EMOJI[p.token] || "") + " " + escapeHtml(p.name)).join(", ") + '</p>';
    }

    $("#tile-info-body").innerHTML = html;
    $("#modal-tile-info").classList.remove("hidden");
  }
  $("#btn-close-tile-info").addEventListener("click", () => $("#modal-tile-info").classList.add("hidden"));

  function updateBoard(state) {
    if (!boardBuilt) buildBoard();
    const currentPlayer = state.players[state.currentPlayerIndex];
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

      // Highlight the tile the current (active-turn) player is standing on,
      // with a bigger glowing outline, so it's obvious "who is where" at a glance.
      el.classList.toggle("tile-current-player", !!currentPlayer && currentPlayer.position === tile.id && !currentPlayer.bankrupt);

      const tokensEl = el.querySelector('[data-role="tokens"]');
      tokensEl.innerHTML = "";
      state.players.filter((p) => p.position === tile.id && !p.bankrupt).forEach((p) => {
        const av = document.createElement("div");
        av.className = "token-avatar" + (currentPlayer && p.id === currentPlayer.id ? " token-active-turn" : "");
        av.style.borderColor = p.color;
        av.textContent = TOKEN_EMOJI[p.token] || "🙂";
        av.title = p.name;
        tokensEl.appendChild(av);
      });
    });
  }

  // ---- side panel: players / properties / log / chat --------------------------------------
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
      const tile = tileById(p.position);
      const isLocalSeat = localSeatIds.indexOf(p.id) !== -1;
      const card = document.createElement("div");
      card.className = "player-card" + (idx === state.currentPlayerIndex ? " current-turn" : "") + (p.bankrupt ? " is-bankrupt" : "") + (p.id === activeSeatId ? " is-active-seat" : "");
      card.innerHTML =
        '<div class="player-avatar-token" style="border-color:' + p.color + '">' + (TOKEN_EMOJI[p.token] || "🙂") + '</div>' +
        '<div style="flex:1">' +
        '<div class="player-card-name" style="color:' + p.color + '">' + escapeHtml(p.name) + (isLocalSeat ? " 📱" : "") + '</div>' +
        '<div class="player-card-money">' + money(p.money) + '</div>' +
        '<div class="player-card-position">📍 ' + escapeHtml(tile ? tile.name : "—") + '</div>' +
        '<div class="player-card-badges">' +
        (p.inJail ? '<span class="badge badge-jail">জেলে</span>' : "") +
        (p.bankrupt ? '<span class="badge">দেউলিয়া</span>' : "") +
        (!p.connected ? '<span class="badge">অফলাইন</span>' : "") +
        (p.getOutOfJailCards > 0 ? '<span class="badge">🎫 x' + p.getOutOfJailCards + '</span>' : "") +
        '</div></div>';
      if (isLocalSeat && localSeatIds.length > 1) {
        card.classList.add("is-clickable-seat");
        card.addEventListener("click", () => { activeSeatId = p.id; renderAll(state); });
      }
      wrap.appendChild(card);
    });
  }

  // ---- "সবার সম্পত্তি" — every player's property ownership, visible to all ----
  function renderAllProperties(state) {
    const wrap = $("#all-properties-list");
    wrap.innerHTML = "";
    const owners = state.players.filter((p) => !p.bankrupt);
    if (!owners.length) { wrap.innerHTML = "<p>কোনো খেলোয়াড় নেই।</p>"; return; }
    owners.forEach((p) => {
      const block = document.createElement("div");
      block.className = "owner-block";
      const propsHtml = (p.properties || []).length
        ? p.properties.map((tid) => {
            const tile = tileById(tid);
            const st = state.propertyState[tid];
            const status = st.mortgaged ? "🔒 বন্ধক" : (st.houses === 5 ? "🏨 হোটেল" : st.houses > 0 ? "🏠×" + st.houses : "খালি");
            return '<div class="owner-prop-row"><span class="tile-info-swatch" style="background:' +
              (tile.type === "property" ? GROUP_COLORS[tile.group] : "#555") + '"></span>' +
              escapeHtml(tile.name) + ' <span class="owner-prop-status">' + status + '</span></div>';
          }).join("")
        : '<div class="owner-prop-row"><em>কোনো সম্পত্তি নেই</em></div>';
      block.innerHTML =
        '<div class="owner-block-head" style="color:' + p.color + '">' + (TOKEN_EMOJI[p.token] || "🙂") + ' ' + escapeHtml(p.name) + ' — ' + money(p.money) + '</div>' +
        propsHtml;
      wrap.appendChild(block);
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
    emitAs("sendChat", { text: input.value.trim() });
    input.value = "";
  }

  // ---- seat switcher (pass-and-play) -----------------------------------------
  function renderSeatSwitcher(state) {
    const bar = $("#seat-switcher");
    if (localSeatIds.length <= 1) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
    bar.classList.remove("hidden");
    bar.innerHTML = '<div class="seat-switcher-label">📱 এই ডিভাইসে:</div>';
    localSeatIds.forEach((pid) => {
      const p = seatPlayer(pid);
      if (!p) return;
      const chip = document.createElement("button");
      chip.className = "seat-chip" + (pid === activeSeatId ? " active" : "");
      chip.style.borderColor = p.color;
      chip.innerHTML = (TOKEN_EMOJI[p.token] || "🙂") + " " + escapeHtml(p.name);
      chip.addEventListener("click", () => { activeSeatId = pid; renderAll(state); });
      bar.appendChild(chip);
    });
  }

  // ---- turn indicator + controls ---------------------------------------------
  function renderTurnBar(state) {
    const cur = state.players[state.currentPlayerIndex];
    const curTile = cur ? tileById(cur.position) : null;
    $("#turn-indicator").textContent = cur ? "🎯 এখন পালা: " + cur.name + (cur.id === activeSeatId ? " (আপনি)" : "") : "—";
    $("#turn-location").textContent = cur && curTile ? "📍 বর্তমান অবস্থান: " + curTile.name : "";

    // Prompt to pass the phone when it's a different local seat's turn.
    if (cur && localSeatIds.length > 1 && localSeatIds.indexOf(cur.id) !== -1) {
      const key = state.currentPlayerIndex + ":" + (state.turn.doublesCount || 0);
      if (cur.id !== activeSeatId) {
        activeSeatId = cur.id;
      }
      if (key !== lastAutoSwitchTurnKey) {
        lastAutoSwitchTurnKey = key;
        toast("📱 ফোনটি এখন " + cur.name + " কে দিন — তার পালা!");
      }
    }

    const myTurn = isMyTurn();
    const me = myPlayer();

    $("#btn-roll").disabled = !myTurn || (state.turn.hasRolled && !state.turn.awaitingReRoll) || !!state.turn.pendingAction || (me && me.inJail);
    $("#btn-end-turn").disabled = !myTurn || state.turn.awaitingReRoll || !!state.turn.pendingAction || !state.turn.hasRolled;
    $("#btn-trade").disabled = !state.started || state.finished;
  }

  $("#btn-roll").addEventListener("click", () => emitAs("rollDice"));
  $("#btn-end-turn").addEventListener("click", () => emitAs("endTurn"));

  const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  function animateDice(d1, d2, playerName) {
    const disp = $("#dice-display");
    disp.classList.remove("hidden");
    $("#die-1").textContent = DICE_FACES[d1];
    $("#die-2").textContent = DICE_FACES[d2];
    $("#dice-roller-name").textContent = playerName ? playerName + " তুললেন" : "";
    $("#dice-total").textContent = "= " + (d1 + d2);
    $("#die-1").style.animation = "none"; void $("#die-1").offsetHeight; $("#die-1").style.animation = "";
    $("#die-2").style.animation = "none"; void $("#die-2").offsetHeight; $("#die-2").style.animation = "";
    beep(300 + d1 * 40);
    clearTimeout(animateDice._t);
    animateDice._t = setTimeout(() => disp.classList.add("hidden"), 3000);
  }

  let lastDiceKey = null;
  function checkDiceAnimation(state) {
    if (state.turn.lastDice) {
      const key = state.turn.lastDice.join(",") + state.currentPlayerIndex + state.turn.doublesCount;
      if (key !== lastDiceKey) {
        lastDiceKey = key;
        const roller = state.players[state.currentPlayerIndex];
        animateDice(state.turn.lastDice[0], state.turn.lastDice[1], roller ? roller.name : "");
      }
    }
  }

  // ---- shared card-draw popup (সুযোগ / ভাগ্য পরীক্ষা) — everyone sees it -------
  let lastSeenCardDrawId = null;
  function checkCardDrawPopup(state) {
    const draw = state.lastCardDraw;
    if (!draw || draw.id === lastSeenCardDrawId) return;
    lastSeenCardDrawId = draw.id;
    const box = $("#card-draw-popup");
    box.className = "card-draw-popup " + (draw.deck === "chance" ? "deck-chance" : "deck-luck");
    box.innerHTML =
      '<div class="card-draw-deck-name">' + (draw.deck === "chance" ? "❓ সুযোগ" : "🍀 ভাগ্য পরীক্ষা") + '</div>' +
      '<div class="card-draw-player">' + escapeHtml(draw.playerName) + ' তুললেন</div>' +
      '<div class="card-draw-text">' + escapeHtml(draw.text) + '</div>';
    box.classList.remove("hidden");
    beep(520, 0.1);
    clearTimeout(checkCardDrawPopup._t);
    checkCardDrawPopup._t = setTimeout(() => box.classList.add("hidden"), 4200);
  }

  // ============================================================================
  // MODALS — buy / auction / jail / bankrupt / trade
  // ============================================================================
  function updateModals(state) {
    const me = myPlayer();

    const buyAction = state.turn.pendingAction && state.turn.pendingAction.type === "buyDecision" ? state.turn.pendingAction : null;
    if (buyAction && buyAction.playerId === activeSeatId) {
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
      const iAmOut = state.auction.biddersLeft.indexOf(activeSeatId) === -1;
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
    if (raiseAction && raiseAction.playerId === activeSeatId) {
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

    if (state.pendingTrade && state.pendingTrade.toId === activeSeatId && state.pendingTrade.id !== seenTradeId) {
      seenTradeId = state.pendingTrade.id;
      showIncomingTrade(state.pendingTrade, state);
    }
    // If the trade is meant for a *different* local seat on this device, switch to it.
    if (state.pendingTrade && localSeatIds.indexOf(state.pendingTrade.toId) !== -1 && state.pendingTrade.toId !== activeSeatId && state.pendingTrade.id !== seenTradeId) {
      activeSeatId = state.pendingTrade.toId;
      seenTradeId = state.pendingTrade.id;
      toast("📱 ফোনটি " + (seatPlayer(activeSeatId) || {}).name + " কে দিন — তার কাছে ট্রেড প্রস্তাব এসেছে।");
      showIncomingTrade(state.pendingTrade, state);
    }
    if (!state.pendingTrade) {
      $("#modal-trade-incoming").classList.add("hidden");
      seenTradeId = null;
    }
  }

  $("#btn-confirm-buy").addEventListener("click", () => emitAs("buyProperty", { tileId: Number($("#modal-buy").dataset.tileId) }));
  $("#btn-decline-buy").addEventListener("click", () => emitAs("declineProperty", { tileId: Number($("#modal-buy").dataset.tileId) }));
  $("#btn-auction-bid").addEventListener("click", () => {
    const val = Number($("#auction-bid-input").value);
    if (!val || val < 1) return toast("সঠিক পরিমাণ লিখুন");
    emitAs("placeBid", { amount: val });
    $("#auction-bid-input").value = "";
  });
  $("#btn-auction-pass").addEventListener("click", () => emitAs("passAuction"));
  $("#btn-jail-pay").addEventListener("click", () => emitAs("payJailFine"));
  $("#btn-jail-card").addEventListener("click", () => emitAs("useJailCard"));
  $("#btn-jail-roll").addEventListener("click", () => emitAs("rollDice"));
  $("#btn-declare-bankrupt").addEventListener("click", () => emitAs("declareBankrupt"));
  $("#btn-open-properties-from-bankrupt").addEventListener("click", () => openPropertiesModal());

  // ---- my properties modal --------------------------------------------------
  $("#btn-my-properties").addEventListener("click", openPropertiesModal);
  $("#btn-close-properties").addEventListener("click", () => $("#modal-properties").classList.add("hidden"));

  function openPropertiesModal() {
    if (!latestState) return;
    const me = myPlayer();
    if (!me) return;
    $("#modal-properties-title").textContent = "🏠 " + me.name + " এর সম্পত্তি";
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
        mbtn.addEventListener("click", () => emitAs("mortgage", { tileId: tid }));
        actions.appendChild(mbtn);
      } else {
        const ubtn = document.createElement("button");
        ubtn.className = "btn btn-ghost btn-sm";
        ubtn.textContent = "বন্ধক মুক্ত করুন";
        ubtn.addEventListener("click", () => emitAs("unmortgage", { tileId: tid }));
        actions.appendChild(ubtn);
      }

      if (tile.type === "property" && groupComplete && !pState.mortgaged) {
        if (pState.houses < 5) {
          const bbtn = document.createElement("button");
          bbtn.className = "btn btn-secondary btn-sm";
          bbtn.textContent = pState.houses === 4 ? "হোটেল বানান" : "বাড়ি বানান";
          bbtn.addEventListener("click", () => emitAs("buildHouse", { tileId: tid }));
          actions.appendChild(bbtn);
        }
        if (pState.houses > 0) {
          const sbtn = document.createElement("button");
          sbtn.className = "btn btn-ghost btn-sm";
          sbtn.textContent = "বাড়ি বিক্রি করুন";
          sbtn.addEventListener("click", () => emitAs("sellHouse", { tileId: tid }));
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
    const others = latestState.players.filter((p) => p.id !== activeSeatId && !p.bankrupt);
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
    emitAs("proposeTrade", { toId: toId, offer: offer });
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
  $("#btn-trade-accept").addEventListener("click", () => { emitAs("respondTrade", { accept: true }); $("#modal-trade-incoming").classList.add("hidden"); });
  $("#btn-trade-reject").addEventListener("click", () => { emitAs("respondTrade", { accept: false }); $("#modal-trade-incoming").classList.add("hidden"); });

  // ============================================================================
  // MAIN STATE HANDLER
  // ============================================================================
  function renderAll(state) {
    showScreen("game");
    renderSeatSwitcher(state);
    updateBoard(state);
    renderPlayerCards(state);
    renderAllProperties(state);
    renderLog(state);
    renderChat(state);
    renderTurnBar(state);
    checkDiceAnimation(state);
    checkCardDrawPopup(state);
    updateModals(state);
  }

  socket.on("state", (state) => {
    state.allReadyComputed = state.players.length >= 2 && state.players.every((p) => p.ready);
    latestState = state;

    if (!state.started) {
      showScreen("lobby");
      renderLobby(state);
      return;
    }

    renderAll(state);
  });

  setInterval(() => {
    if (latestState && latestState.auction) updateModals(latestState);
  }, 500);

  // default screen
  showScreen("home");
})();
