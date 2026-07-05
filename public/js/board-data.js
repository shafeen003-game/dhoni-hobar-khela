// ============================================================================
// BOARD DATA — "ধনী হবার মজার খেলা" (Dhoni Hobar Mojar Khela)
// Isomorphic module: works in Node (module.exports) and in the browser
// (attaches to window.BOARD_DATA).
// ============================================================================

(function (root) {
  "use strict";

  // ---- Core game constants (from the printed rulebook) -------------------
  const CONSTANTS = {
    STARTING_MONEY: 2800,
    STARTING_MONEY_BREAKDOWN: [
      { note: 1000, count: 1 },
      { note: 500, count: 2 },
      { note: 200, count: 2 },
      { note: 100, count: 2 },
      { note: 50, count: 1 },
      { note: 10, count: 1 },
      { note: 5, count: 2 }
    ],
    PASS_START_BONUS: 200, // corrected per rulebook packaging (২০০/= passing Start)
    JAIL_FINE: 50,
    MAX_DOUBLES_BEFORE_JAIL: 3,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 6,
    HOUSE_BUILD_INCREMENT: true, // must own full color group to build
    MAX_HOUSES_PER_PROPERTY: 4, // 5th level = hotel
    MORTGAGE_INTEREST: 0.1, // 10% interest to un-mortgage
    AUCTION_MIN_BID: 1,
    AUCTION_COUNTDOWN_SECONDS: 15,
    TURN_TIMER_SECONDS: 60
  };

  // ---- Colors used for property groups (also used for token colors) ------
  const COLORS = {
    brown: "#8b5e3c",
    lightblue: "#7ec8e3",
    pink: "#e85d9c",
    orange: "#f2994a",
    red: "#e0483f",
    yellow: "#f4d03f",
    green: "#27ae60",
    darkblue: "#1a5276",
    maroon: "#7b241c",
    purple: "#6c3483",
    railway: "#2c2c2c",
    utility: "#8395a7"
  };

  // ---- Tokens available for players ---------------------------------------
  const TOKENS = ["car", "boat", "hat", "dog", "plane", "camera"];

  // ---- The 40 tiles, in clockwise order starting at যাত্রা শুরু (Start) ----
  // type: start | property | railway | utility | chance | luck | tax | jail | goToJail | freeParking
  const TILES = [
    { id: 0, type: "start", name: "যাত্রা শুরু" },

    { id: 1, type: "property", name: "লামা বাজার", group: "brown", price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50 },
    { id: 2, type: "luck", name: "ভাগ্য পরীক্ষা" },
    { id: 3, type: "property", name: "মীরা বাজার", group: "brown", price: 60, rent: [4, 20, 60, 180, 320, 450], houseCost: 50 },
    { id: 4, type: "tax", name: "আয়কর", amount: 200 },
    { id: 5, type: "railway", name: "সিলেট স্টেশন", price: 200, rent: [25, 50, 100, 200] },
    { id: 6, type: "property", name: "আম্বর খানা", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
    { id: 7, type: "chance", name: "সুযোগ" },
    { id: 8, type: "property", name: "জিন্দা বাজার", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
    { id: 9, type: "property", name: "বন্দর বাজার", group: "lightblue", price: 120, rent: [8, 40, 100, 300, 450, 600], houseCost: 50 },

    { id: 10, type: "jail", name: "জেলখানার ভিতর" },

    { id: 11, type: "property", name: "আকুয়া", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
    { id: 12, type: "utility", name: "বিদ্যুৎ সুবিধা", price: 150 },
    { id: 13, type: "property", name: "নন্দী বাড়ি", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
    { id: 14, type: "property", name: "কলেজ রোড", group: "orange", price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100 },
    { id: 15, type: "railway", name: "ময়মনসিংহ স্টেশন", price: 200, rent: [25, 50, 100, 200] },
    { id: 16, type: "property", name: "পন্ডিত পাড়া", group: "orange", price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100 },
    { id: 17, type: "luck", name: "ভাগ্য পরীক্ষা" },
    { id: 18, type: "property", name: "কেওয়াটখালি", group: "red", price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
    { id: 19, type: "property", name: "বড় বাজার", group: "red", price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },

    { id: 20, type: "freeParking", name: "পার্কিং সুবিধা" },

    { id: 21, type: "property", name: "বাটালি হিল", group: "yellow", price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 150 },
    { id: 22, type: "chance", name: "সুযোগ" },
    { id: 23, type: "property", name: "পাথর ঘাটা", group: "yellow", price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 150 },
    { id: 24, type: "property", name: "মেহেদি বাগ", group: "green", price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
    { id: 25, type: "railway", name: "চট্টগ্রাম স্টেশন", price: 200, rent: [25, 50, 100, 200] },
    { id: 26, type: "property", name: "লাল দিঘীর ময়দান", group: "green", price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
    { id: 27, type: "property", name: "আগ্রাবাদ", group: "green", price: 240, rent: [20, 100, 300, 750, 925, 1100], houseCost: 150 },
    { id: 28, type: "utility", name: "পানি সুবিধা", price: 150 },
    { id: 29, type: "property", name: "কুলশী", group: "darkblue2", price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },

    { id: 30, type: "goToJail", name: "জেলখানায় যান" },

    { id: 31, type: "property", name: "ওয়ারী", group: "maroon", price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 200 },
    { id: 32, type: "property", name: "মতিঝিল", group: "maroon", price: 280, rent: [24, 120, 360, 850, 1025, 1200], houseCost: 200 },
    { id: 33, type: "luck", name: "ভাগ্য পরীক্ষা" },
    { id: 34, type: "property", name: "ধানমন্ডি", group: "purple", price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
    { id: 35, type: "railway", name: "কমলাপুর স্টেশন", price: 200, rent: [25, 50, 100, 200] },
    { id: 36, type: "chance", name: "সুযোগ" },
    { id: 37, type: "property", name: "বনানী", group: "purple", price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
    { id: 38, type: "tax", name: "কর পরিশোধ", amount: 100 },
    { id: 39, type: "property", name: "গুলশান", group: "purple", price: 320, rent: [28, 150, 450, 1000, 1200, 1400], houseCost: 200 }
  ];

  // Groups that need full-set ownership before building houses.
  // darkblue2 (কুলশী) is a lone tile in this board's layout, so owning it
  // alone already counts as a completed "group" for building purposes.
  const GROUP_COLORS = {
    brown: COLORS.brown,
    lightblue: COLORS.lightblue,
    pink: COLORS.pink,
    orange: COLORS.orange,
    red: COLORS.red,
    yellow: COLORS.yellow,
    green: COLORS.green,
    darkblue2: COLORS.darkblue,
    maroon: COLORS.maroon,
    purple: COLORS.purple
  };

  function groupTileIds(group) {
    return TILES.filter((t) => t.type === "property" && t.group === group).map((t) => t.id);
  }

  const BOARD_DATA = {
    CONSTANTS,
    COLORS,
    TOKENS,
    TILES,
    GROUP_COLORS,
    groupTileIds
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = BOARD_DATA;
  } else {
    root.BOARD_DATA = BOARD_DATA;
  }
})(typeof window !== "undefined" ? window : global);
