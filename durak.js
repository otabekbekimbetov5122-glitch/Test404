'use strict';
/**
 * Дурак (подкидной, 2–4 ўйинчи, 36 карта) — ўйин логикаси.
 * Сервер ҳам, браузер (компьютерга қарши) ҳам шу файлни ишлатади.
 * Ҳамма қоидалар шу ерда текширилади.
 *
 * Соддалаштиришлар: мудофаачи картани олганда (take) қўшимча карта
 * ташлаб бўлмайди; «переводной» режим йўқ.
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HAND_SIZE = 6;
const MAX_TABLE = 6;

// ---------- Ёрдамчи функциялар ----------

function makeDeck() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 9; r++) deck.push({ suit: s, rank: r });
  return deck;
}

function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const cardName = (c) => RANKS[c.rank] + SUITS[c.suit];
const sameCard = (a, b) => a.suit === b.suit && a.rank === b.rank;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** def картаси att картасини ураладими? */
function beats(def, att, trump) {
  if (def.suit === att.suit) return def.rank > att.rank;
  return def.suit === trump && att.suit !== trump;
}

// ---------- Ўйинчилар ҳолати ----------

/** Фаол ўйинчи: ўйиндан чиқарилмаган ва картаси тугамаган. */
const isActive = (s, p) => !s.out[p] && !s.done[p];

function activePlayers(s) {
  const res = [];
  for (let p = 0; p < s.n; p++) if (isActive(s, p)) res.push(p);
  return res;
}

/** from дан КЕЙИНГИ биринчи фаол ўйинчи. */
function nextActive(s, from) {
  for (let i = 1; i <= s.n; i++) {
    const p = (from + i) % s.n;
    if (isActive(s, p)) return p;
  }
  return -1;
}

/** p нинг ўзи (фаол бўлса) ёки ундан кейинги фаол ўйинчи. */
function firstActiveFrom(s, p) {
  return isActive(s, p) ? p : nextActive(s, p);
}

// ---------- Ўйинни бошлаш ----------

function createGame(n = 2, rnd = Math.random) {
  if (typeof n === 'function') { rnd = n; n = 2; }
  if (!Number.isInteger(n) || n < 2 || n > 4) throw new Error('Ўйинчилар сони 2–4 бўлиши керак');

  const deck = shuffle(makeDeck(), rnd);
  const hands = Array.from({ length: n }, () => []);
  for (let i = 0; i < HAND_SIZE; i++) for (let p = 0; p < n; p++) hands[p].push(deck.pop());

  const trumpCard = deck[0]; // колоданинг энг тагида (охирида олинади)
  const trump = trumpCard.suit;

  // Биринчи юрувчи — энг кичик козири бор ўйинчи
  let attacker = -1;
  let best = 99;
  for (let p = 0; p < n; p++) {
    const lowest = hands[p].filter((c) => c.suit === trump).reduce((m, c) => Math.min(m, c.rank), 99);
    if (lowest < best) { best = lowest; attacker = p; }
  }
  if (attacker < 0) attacker = Math.floor(rnd() * n);

  const state = {
    n,
    deck,
    trump,
    trumpCard,
    hands,
    out: Array(n).fill(false),   // ўйиндан чиқарилган (кик)
    done: Array(n).fill(false),  // картаси тугаб, ўйинни тугатган
    finishedGroups: [],          // тугатганлар: [[p,...], ...] (бир вақтда тугатганлар битта гуруҳда)
    kicked: [],
    table: [],                   // [{attack, defense|null}]
    passes: [],                  // «бито» деганлар (стол ўзгармагунча)
    attacker,
    defender: -1,
    discard: [],
    over: false,
    winners: [],
    winner: null,
    loser: null,
    draw: false,
  };
  state.defender = nextActive(state, attacker);
  return state;
}

// ---------- Стол ва навбат ----------

const undefendedCount = (s) => s.table.filter((t) => !t.defense).length;
const allDefended = (s) => s.table.length > 0 && undefendedCount(s) === 0;

function ranksOnTable(s) {
  const set = new Set();
  for (const t of s.table) {
    set.add(t.attack.rank);
    if (t.defense) set.add(t.defense.rank);
  }
  return set;
}

function canAdd(s) {
  return s.table.length < MAX_TABLE && undefendedCount(s) < s.hands[s.defender].length;
}

/** Ҳужум томонидаги p ўйинчи ҳозир ташлай оладиган карталар. */
function attackCards(s, p) {
  if (!canAdd(s)) return [];
  if (s.table.length === 0) return p === s.attacker ? s.hands[p].slice() : [];
  const ranks = ranksOnTable(s);
  return s.hands[p].filter((c) => ranks.has(c.rank));
}

/** Ҳужумчилар (мудофаачидан бошқалар) — асосий ҳужумчидан бошлаб, соат йўналиши бўйича. */
function attackersInOrder(s) {
  const res = [];
  for (let i = 0; i < s.n; i++) {
    const p = (s.attacker + i) % s.n;
    if (p !== s.defender && isActive(s, p)) res.push(p);
  }
  return res;
}

/** Ҳамма ёпилган бўлса, карта қўша оладиган ва «бито» демаган биринчи ҳужумчи (йўқ бўлса -1). */
function nextAttackerToAct(s) {
  for (const p of attackersInOrder(s)) {
    if (s.passes.includes(p)) continue;
    if (attackCards(s, p).length > 0) return p;
  }
  return -1;
}

/** Ҳозир ким юради? (-1 — ўйин тугаган) */
function toMove(s) {
  if (s.over) return -1;
  if (s.table.length === 0) return s.attacker;
  if (undefendedCount(s) > 0) return s.defender;
  return nextAttackerToAct(s);
}

/**
 * Ўйинчининг қонуний юришлари:
 *  {type:'attack', card}            — карта ташлаш (ҳужум / қўшиш)
 *  {type:'defend', index, card}     — столдаги index-карта устидан ёпиш
 *  {type:'take'}                    — картани олиш
 *  {type:'done'}                    — «бито» (қўшмайман)
 */
function legalMoves(s, player) {
  if (toMove(s) !== player) return [];
  const moves = [];
  if (player === s.defender) {
    s.table.forEach((t, index) => {
      if (t.defense) return;
      for (const card of s.hands[player]) {
        if (beats(card, t.attack, s.trump)) moves.push({ type: 'defend', index, card });
      }
    });
    moves.push({ type: 'take' });
  } else {
    for (const card of attackCards(s, player)) moves.push({ type: 'attack', card });
    if (s.table.length > 0) moves.push({ type: 'done' });
  }
  return moves;
}

function sameMove(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'attack') return sameCard(a.card, b.card);
  if (a.type === 'defend') return a.index === b.index && sameCard(a.card, b.card);
  return true;
}

// ---------- Раунд ва ўйин тугаши ----------

function refill(s, order) {
  for (const p of order) {
    while (s.hands[p].length < HAND_SIZE && s.deck.length > 0) s.hands[p].push(s.deck.pop());
  }
}

/** Фаол ўйинчилар ≤ 1 бўлса, ўйинни тугатади ва ғолибларни белгилайди. */
function finalize(s) {
  const rem = activePlayers(s);
  if (rem.length > 1) return;
  s.over = true;
  if (s.finishedGroups.length > 0) {
    s.winners = s.finishedGroups[0].slice();
    s.loser = rem.length === 1 ? rem[0] : null;
    s.draw = rem.length === 0 && s.finishedGroups.length === 1 && s.winners.length > 1;
  } else {
    s.winners = rem.slice(); // бошқалар ҳаммаси чиқарилган
    s.loser = null;
    s.draw = false;
  }
  s.winner = s.winners.length ? s.winners[0] : null;
}

/** Колода бўш бўлса, қўли бўшаганлар ўйинни тугатади. */
function markDone(s) {
  if (s.deck.length === 0) {
    const group = [];
    for (let p = 0; p < s.n; p++) if (isActive(s, p) && s.hands[p].length === 0) group.push(p);
    if (group.length) {
      group.forEach((p) => { s.done[p] = true; });
      s.finishedGroups.push(group);
    }
  }
  finalize(s);
}

function endRound(s, kind) {
  const { attacker, defender } = s;
  if (kind === 'take') {
    for (const t of s.table) {
      s.hands[defender].push(t.attack);
      if (t.defense) s.hands[defender].push(t.defense);
    }
  } else {
    for (const t of s.table) {
      s.discard.push(t.attack);
      if (t.defense) s.discard.push(t.defense);
    }
  }
  s.table = [];
  s.passes = [];

  // Карта олиш тартиби: ҳужумчи, бошқа ҳужумчилар, энг охирида мудофаачи
  const order = [];
  for (let i = 0; i < s.n; i++) {
    const p = (attacker + i) % s.n;
    if (p !== defender && isActive(s, p)) order.push(p);
  }
  if (isActive(s, defender)) order.push(defender);
  refill(s, order);

  markDone(s);
  if (s.over) return;

  // Ёпган мудофаачи ҳужумчи бўлади; олган мудофаачи навбатини йўқотади
  const next = kind === 'done' ? firstActiveFrom(s, defender) : nextActive(s, defender);
  s.attacker = next;
  s.defender = nextActive(s, next);
}

/** Ҳеч ким қўша олмаса, раунд ўзи тугайди. */
function normalize(s) {
  if (s.over) return;
  if (allDefended(s) && nextAttackerToAct(s) === -1) endRound(s, 'done');
}

function removeFromHand(hand, card) {
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i < 0) throw new Error('Карта қўлда йўқ');
  hand.splice(i, 1);
}

// ---------- Юришни бажариш ----------

/** Янги ҳолатни қайтаради. Нотўғри юришда хато беради. */
function applyMove(oldState, player, move) {
  const legal = legalMoves(oldState, player);
  if (!legal.some((m) => sameMove(m, move))) throw new Error('Нотўғри юриш');

  const s = clone(oldState);
  switch (move.type) {
    case 'attack':
      removeFromHand(s.hands[player], move.card);
      s.table.push({ attack: move.card, defense: null });
      s.passes = [];
      break;
    case 'defend':
      removeFromHand(s.hands[player], move.card);
      s.table[move.index].defense = move.card;
      break;
    case 'take':
      endRound(s, 'take');
      break;
    case 'done':
      s.passes.push(player);
      break;
  }
  normalize(s);
  return s;
}

/** Ўйинчини ўйиндан чиқариш (кик). Карталари discard га ўтади. */
function eliminate(oldState, p) {
  const s = clone(oldState);
  if (s.over || !isActive(s, p)) return s;

  const wasMain = p === s.attacker || p === s.defender;
  s.out[p] = true;
  s.kicked.push(p);
  s.discard.push(...s.hands[p]);
  s.hands[p] = [];
  s.passes = s.passes.filter((x) => x !== p);
  if (wasMain) {
    for (const t of s.table) {
      s.discard.push(t.attack);
      if (t.defense) s.discard.push(t.defense);
    }
    s.table = [];
    s.passes = [];
  }

  finalize(s);
  if (s.over) return s;

  if (wasMain) {
    s.attacker = nextActive(s, p);
    s.defender = nextActive(s, s.attacker);
  }
  normalize(s);
  return s;
}

// ---------- Ўйинчи кўриши (рақибларнинг карталарини яшириш) ----------

function viewFor(s, player) {
  const opponents = [];
  for (let i = 1; i < s.n; i++) {
    const q = (player + i) % s.n;
    opponents.push({ index: q, count: s.hands[q].length, out: s.out[q], done: s.done[q] });
  }
  return {
    you: player,
    n: s.n,
    hand: s.hands[player],
    opponents,
    opponentCount: opponents.length ? opponents[0].count : 0,
    deckCount: s.deck.length,
    trump: s.trump,
    trumpCard: s.deck.length > 0 ? s.trumpCard : null,
    table: s.table,
    attacker: s.attacker,
    defender: s.defender,
    toMove: toMove(s),
    discardCount: s.discard.length,
    youOut: s.out[player],
    youDone: s.done[player],
    moves: legalMoves(s, player), // faqat shu o'yinchining qonuniy yurishlari
    over: s.over,
    winner: s.winner,
    winners: s.winners,
    loser: s.loser,
    draw: s.draw,
  };
}

// ---------- Компьютер (оддий AI) ----------

function chooseMove(s, player) {
  const moves = legalMoves(s, player);
  if (moves.length === 0) return null;
  const trump = s.trump;
  const cost = (c) => c.rank + (c.suit === trump ? 20 : 0);

  if (player !== s.defender) {
    const attacks = moves.filter((m) => m.type === 'attack');
    const done = moves.find((m) => m.type === 'done');
    if (attacks.length === 0) return done;

    const hand = s.hands[player];
    // Жуфт рангли карталарни олдин ташлаш бироз яхшироқ
    const score = (m) =>
      cost(m.card) - (hand.filter((c) => c.rank === m.card.rank).length > 1 ? 0.5 : 0);
    attacks.sort((a, b) => score(a) - score(b));
    const best = attacks[0];

    // Қўшишда козирни асраймиз (колода катта бўлса)
    if (s.table.length > 0 && best.card.suit === trump && s.deck.length > 3 && done) return done;
    return best;
  }

  // Мудофаа
  const take = moves.find((m) => m.type === 'take');
  const firstUndefended = s.table.findIndex((t) => !t.defense);
  const defends = moves.filter((m) => m.type === 'defend' && m.index === firstUndefended);
  if (defends.length === 0) return take;
  defends.sort((a, b) => cost(a.card) - cost(b.card));
  const best = defends[0];
  const attackCard = s.table[firstUndefended].attack;

  // Кичик картани урмоқ учун козир сарфламаймиз
  if (best.card.suit === trump && attackCard.suit !== trump && attackCard.rank <= 4 && s.deck.length >= 4) {
    return take;
  }
  return best;
}

/**
 * Вақт тугаганда ўйинчи ўрнига қилинадиган оддий юриш:
 * мудофаачи — картани олади; ҳужумчи — «бито», стол бўш бўлса энг кичик карта.
 */
function autoMove(s, player) {
  const moves = legalMoves(s, player);
  if (moves.length === 0) return null;
  if (player === s.defender) return moves.find((m) => m.type === 'take');
  const done = moves.find((m) => m.type === 'done');
  if (done) return done;
  const cost = (c) => c.rank + (c.suit === s.trump ? 20 : 0);
  return moves.filter((m) => m.type === 'attack').sort((a, b) => cost(a.card) - cost(b.card))[0];
}

const API = {
  SUITS,
  RANKS,
  HAND_SIZE,
  MAX_TABLE,
  cardName,
  createGame,
  toMove,
  legalMoves,
  applyMove,
  eliminate,
  viewFor,
  chooseMove,
  autoMove,
};

// Node.js (сервер) ва браузер (Mini App) учун бир хил файл
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.Durak = API;
