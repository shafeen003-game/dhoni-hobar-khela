// ============================================================================
// CARD DECKS — সুযোগ (Chance) and ভাগ্য পরীক্ষা (Luck)
// Each card has: text (shown to players) + effect (executed by the engine)
// effect.type drives server/gameEngine.js's applyCardEffect()
// ============================================================================

const CHANCE_CARDS = [
  { text: "ব্যাংক থেকে ১০০ টাকা বোনাস পান।", effect: { type: "money", amount: 100 } },
  { text: "আয়কর ফেরত — ৫০ টাকা পান।", effect: { type: "money", amount: 50 } },
  { text: "১৫০ টাকা জরিমানা দিন।", effect: { type: "money", amount: -150 } },
  { text: "রাস্তা মেরামতের খরচ — ৭৫ টাকা দিন।", effect: { type: "money", amount: -75 } },
  { text: "সরাসরি যাত্রা শুরু ঘরে চলে যান এবং বোনাস নিন।", effect: { type: "advanceTo", tile: 0, collectBonus: true } },
  { text: "সরাসরি জেলখানায় যান। যাত্রা শুরু বোনাস পাবেন না।", effect: { type: "goToJail" } },
  { text: "৩ ঘর পিছিয়ে যান।", effect: { type: "moveRelative", steps: -3 } },
  { text: "৫ ঘর সামনে এগিয়ে যান।", effect: { type: "moveRelative", steps: 5 } },
  { text: "নিকটতম স্টেশনে যান। মালিক থাকলে দ্বিগুণ ভাড়া দিন।", effect: { type: "advanceToNearest", kind: "railway", doubleRent: true } },
  { text: "নিকটতম সুবিধা কেন্দ্রে (বিদ্যুৎ/পানি) যান।", effect: { type: "advanceToNearest", kind: "utility" } },
  { text: "প্রত্যেক খেলোয়াড়ের কাছ থেকে ৫০ টাকা করে আদায় করুন।", effect: { type: "collectFromAll", amount: 50 } },
  { text: "প্রত্যেক খেলোয়াড়কে ৫০ টাকা করে দিন।", effect: { type: "payAll", amount: 50 } },
  { text: "জেল থেকে মুক্তির কার্ড পান — যেকোনো সময় ব্যবহার করতে পারবেন।", effect: { type: "getOutOfJailCard" } },
  { text: "ব্যাংক থেকে ২০০ টাকা পুরস্কার পান।", effect: { type: "money", amount: 200 } },
  { text: "সম্পত্তি মেরামতের জন্য প্রতিটি বাড়ির জন্য ২৫ ও হোটেলের জন্য ১০০ টাকা দিন।", effect: { type: "repairTax", perHouse: 25, perHotel: 100 } },
  { text: "ভ্রমণ পুরস্কার — ১২০ টাকা পান।", effect: { type: "money", amount: 120 } }
];

const LUCK_CARDS = [
  { text: "লটারি জিতেছেন — ২৫০ টাকা পান।", effect: { type: "money", amount: 250 } },
  { text: "হাসপাতালের বিল — ১০০ টাকা দিন।", effect: { type: "money", amount: -100 } },
  { text: "উপহার পেয়েছেন — ৭৫ টাকা পান।", effect: { type: "money", amount: 75 } },
  { text: "জরিমানা — ৫০ টাকা দিন।", effect: { type: "money", amount: -50 } },
  { text: "বিনামূল্যে একটি বাড়ি পান (নিজের যেকোনো সম্পত্তিতে)।", effect: { type: "freeHouse" } },
  { text: "সরাসরি যাত্রা শুরু ঘরে চলে যান এবং বোনাস নিন।", effect: { type: "advanceTo", tile: 0, collectBonus: true } },
  { text: "সরাসরি জেলখানায় যান।", effect: { type: "goToJail" } },
  { text: "২ ঘর সামনে এগিয়ে যান।", effect: { type: "moveRelative", steps: 2 } },
  { text: "৪ ঘর পিছিয়ে যান।", effect: { type: "moveRelative", steps: -4 } },
  { text: "ব্যবসায় লাভ — ১৫০ টাকা পান।", effect: { type: "money", amount: 150 } },
  { text: "প্রত্যেক খেলোয়াড়ের কাছ থেকে ২৫ টাকা করে আদায় করুন।", effect: { type: "collectFromAll", amount: 25 } },
  { text: "প্রত্যেক খেলোয়াড়কে ২৫ টাকা করে দিন।", effect: { type: "payAll", amount: 25 } },
  { text: "জেল থেকে মুক্তির কার্ড পান।", effect: { type: "getOutOfJailCard" } },
  { text: "চুরি হয়েছে — ১২৫ টাকা হারালেন।", effect: { type: "money", amount: -125 } },
  { text: "উৎসব বোনাস — ১০০ টাকা পান।", effect: { type: "money", amount: 100 } },
  { text: "জেলখানা থেকে বিনা জরিমানায় মুক্তি (এখন জেলে থাকলে প্রযোজ্য)।", effect: { type: "freeFromJailNow" } }
];

module.exports = { CHANCE_CARDS, LUCK_CARDS };
