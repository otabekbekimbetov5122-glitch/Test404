'use strict';
/**
 * Onlayn xonalar: 2-4 o'yinchi, tikish (coin), 20 soniya vaqt, 3 ogohlantirish, bank hisobi.
 * Tarmoqsiz ishlaydi (soat va hamyon tashqaridan beriladi), shuning uchun oson sinaladi.
 *
 * Qoidalar:
 *  - Har bir o'yinchi STAKE coin tikadi; pul xonaga "ushlanadi" (hold).
 *  - Birinchi bo'lib kartasi tugagan o'yinchi butun bankning 95% ini oladi, 5% botda qoladi.
 *  - Durang (hamma birdaniga tugatsa): tikishlar qaytariladi, komissiya olinmaydi.
 *  - 20 soniya ichida yurmagan o'yinchiga ogohlantirish + avtomatik yurish;
 *    3-ogohlantirishda o'yindan chiqariladi va tikkanini yo'qotadi.
 *  - Coin faqat o'yin ichida: yechib olish yoki boshqaga o'tkazish yo'q.
 */

const Durak = require('./durak.js');

const STAKES = [100, 200, 500, 1000, 2000, 5000, 10000, 50000, 100000];

// ---------- Hamyon (sinash uchun xotiradagi variant) ----------

class MemoryWallet {
  constructor() {
    this.balances = new Map();
    this.house = 0; // botning komissiyasi
    this.ledger = [];
  }
  balance(id) { return this.balances.get(id) || 0; }
  _check(amount) {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("Noto'g'ri summa");
  }
  /** O'yinchiga coin qo'shish (do'kon, vazifa va h.k.). */
  credit(id, amount, ref = 'credit') {
    this._check(amount);
    this.balances.set(id, this.balance(id) + amount);
    this.ledger.push({ type: ref, id, amount });
  }
  /** Tikishni ushlab turish. */
  hold(id, amount, ref) {
    this._check(amount);
    if (this.balance(id) < amount) throw new Error('Coin yetarli emas');
    this.balances.set(id, this.balance(id) - amount);
    this.ledger.push({ type: 'hold', id, amount, ref });
  }
  /** Ushlangan tikishni qaytarish. */
  release(id, amount, ref) {
    this._check(amount);
    this.balances.set(id, this.balance(id) + amount);
    this.ledger.push({ type: 'release', id, amount, ref });
  }
  /** Xonani yakunlash: g'oliblarga to'lov + botga komissiya (bitta amalda). */
  settle(ref, payouts, fee) {
    payouts.forEach((p) => {
      this._check(p.amount);
      this.balances.set(p.id, this.balance(p.id) + p.amount);
      this.ledger.push({ type: 'payout', id: p.id, amount: p.amount, ref });
    });
    if (fee > 0) {
      this._check(fee);
      this.house += fee;
      this.ledger.push({ type: 'fee', amount: fee, ref });
    }
  }
}

// ---------- Xona ----------

class Room {
  constructor(opts) {
    const {
      id, stake, seats, wallet,
      clock = { setTimeout, clearTimeout, now: () => Date.now() },
      emit = () => {},
      turnMs = 20000,
      maxWarnings = 3,
      feePercent = 5,
      rnd = Math.random,
    } = opts;
    if (!STAKES.includes(stake)) throw new Error("Noto'g'ri tikish miqdori");
    if (!Number.isInteger(seats) || seats < 2 || seats > 4) throw new Error("O'yinchilar soni 2-4 bo'lishi kerak");

    Object.assign(this, { id, stake, seats, wallet, clock, turnMs, maxWarnings, feePercent, rnd });
    this._emit = (event, data) => emit(event, data || {}, this);
    this.players = []; // [{id, name, photo, warnings}] - indeks = o'rindiq
    this.status = 'waiting'; // waiting | playing | finished
    this.state = null;
    this.deadline = null;
    this.timer = null;
    this.result = null;
  }

  get isFull() { return this.players.length === this.seats; }
  seatOf(userId) { return this.players.findIndex((p) => p.id === userId); }

  join(user) {
    if (this.status !== 'waiting') throw new Error("Xona to'lgan yoki o'yin boshlangan");
    if (this.seatOf(user.id) >= 0) throw new Error('Siz allaqachon xonadasiz');
    this.wallet.hold(user.id, this.stake, this.id);
    this.players.push({ id: user.id, name: user.name || '', photo: user.photo || null, warnings: 0 });
    this._emit('joined', { userId: user.id });
    if (this.isFull) this._start();
  }

  leave(userId) {
    if (this.status !== 'waiting') throw new Error("O'yin boshlangan, chiqib bo'lmaydi");
    const seat = this.seatOf(userId);
    if (seat < 0) throw new Error('Siz xonada emassiz');
    this.wallet.release(userId, this.stake, this.id);
    this.players.splice(seat, 1);
    this._emit('left', { userId });
  }

  _start() {
    this.status = 'playing';
    this.state = Durak.createGame(this.seats, this.rnd);
    this._emit('start');
    this._armTimer();
  }

  move(userId, move) {
    if (this.status !== 'playing') throw new Error("O'yin hozir ketmayapti");
    const seat = this.seatOf(userId);
    if (seat < 0) throw new Error('Siz bu xonada emassiz');
    if (Durak.toMove(this.state) !== seat) throw new Error('Sizning navbatingiz emas');
    this.state = Durak.applyMove(this.state, seat, move); // noto'g'ri yurishda xato beradi
    this._after();
  }

  _after() {
    this._clearTimer();
    if (this.state.over) this._finish();
    else {
      this._emit('state');
      this._armTimer();
    }
  }

  _armTimer() {
    const seat = Durak.toMove(this.state);
    this.deadline = this.clock.now() + this.turnMs;
    this.timer = this.clock.setTimeout(() => this._timeout(seat), this.turnMs);
  }

  _clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  _timeout(seat) {
    this.timer = null;
    if (this.status !== 'playing' || Durak.toMove(this.state) !== seat) return;
    const player = this.players[seat];
    player.warnings += 1;
    if (player.warnings >= this.maxWarnings) {
      this._emit('kicked', { userId: player.id, seat });
      this.state = Durak.eliminate(this.state, seat);
    } else {
      this._emit('warning', { userId: player.id, seat, count: player.warnings, max: this.maxWarnings });
      const m = Durak.autoMove(this.state, seat);
      this.state = Durak.applyMove(this.state, seat, m);
    }
    this._after();
  }

  _finish() {
    const s = this.state;
    const ids = (seats) => seats.map((q) => this.players[q].id);
    const pot = this.stake * this.players.length;
    const payouts = [];
    let fee = 0;

    const split = (amount, winnerSeats) => {
      const share = Math.floor(amount / winnerSeats.length);
      const rest = amount - share * winnerSeats.length; // qoldiq botga
      winnerSeats.forEach((q) => payouts.push({ id: this.players[q].id, amount: share }));
      return rest;
    };

    if (s.draw) {
      // Durang: tikishlar qaytariladi; chiqarilganlarning tikishi qolganlar o'rtasida bo'linadi
      s.winners.forEach((q) => payouts.push({ id: this.players[q].id, amount: this.stake }));
      const forfeited = this.stake * s.kicked.length;
      if (forfeited > 0) {
        const f = Math.floor((forfeited * this.feePercent) / 100);
        fee += f;
        fee += split(forfeited - f, s.winners);
      }
    } else {
      fee = Math.floor((pot * this.feePercent) / 100);
      fee += split(pot - fee, s.winners);
    }

    const merged = new Map();
    payouts.forEach((p) => merged.set(p.id, (merged.get(p.id) || 0) + p.amount));
    const list = [...merged].filter(([, a]) => a > 0).map(([id, amount]) => ({ id, amount }));
    this.wallet.settle(this.id, list, fee);

    this.status = 'finished';
    this.result = {
      winners: ids(s.winners),
      loser: s.loser === null ? null : this.players[s.loser].id,
      kicked: ids(s.kicked),
      draw: s.draw,
      pot,
      fee,
      payouts: list,
    };
    this._emit('finished', this.result);
  }

  /** O'yinchiga yuboriladigan holat (raqiblarning kartalari yashirin). */
  viewFor(userId) {
    const seat = this.seatOf(userId);
    const base = {
      id: this.id,
      status: this.status,
      stake: this.stake,
      seats: this.seats,
      pot: this.stake * this.players.length,
      players: this.players.map((p, i) => ({
        id: p.id, name: p.name, photo: p.photo, seat: i, warnings: p.warnings,
      })),
      timeLeft: this.deadline === null ? null : Math.max(0, this.deadline - this.clock.now()),
      turnMs: this.turnMs,
      maxWarnings: this.maxWarnings,
      result: this.result,
    };
    if (this.status === 'waiting' || seat < 0) return base;
    return Object.assign(base, { game: Durak.viewFor(this.state, seat) });
  }
}

// ---------- Lobbi: tez qo'shilish ----------

class Lobby {
  constructor(opts) {
    this.opts = opts; // wallet, clock, turnMs, emit, ...
    this.rooms = new Map();
    this.userRoom = new Map();
    this.nextId = 1;
  }

  roomOf(userId) {
    const r = this.userRoom.get(userId);
    return r && r.status !== 'finished' ? r : null;
  }

  /** Shu tikish va o'yinchilar soniga mos ochiq xonaga qo'shadi yoki yangi xona ochadi. */
  quickJoin(user, stake, seats) {
    if (this.roomOf(user.id)) throw new Error('Siz boshqa xonadasiz');
    let room = [...this.rooms.values()].find(
      (r) => r.status === 'waiting' && r.stake === stake && r.seats === seats && r.seatOf(user.id) < 0
    );
    if (!room) {
      const id = 'r' + this.nextId++;
      const userEmit = this.opts.emit || (() => {});
      room = new Room(Object.assign({}, this.opts, {
        id, stake, seats,
        emit: (event, data, r) => {
          if (event === 'finished') r.players.forEach((p) => {
            if (this.userRoom.get(p.id) === r) this.userRoom.delete(p.id);
          });
          userEmit(event, data, r);
        },
      }));
      this.rooms.set(id, room);
    }
    this.userRoom.set(user.id, room);
    try {
      room.join(user);
    } catch (e) {
      this.userRoom.delete(user.id);
      if (room.players.length === 0) this.rooms.delete(room.id);
      throw e;
    }
    return room;
  }

  leave(userId) {
    const room = this.roomOf(userId);
    if (!room) throw new Error('Siz xonada emassiz');
    room.leave(userId);
    this.userRoom.delete(userId);
    if (room.players.length === 0) this.rooms.delete(room.id);
  }

  /** Tugagan xonalarni o'chirish. */
  cleanup() {
    for (const [id, r] of this.rooms) if (r.status === 'finished') this.rooms.delete(id);
  }
}

module.exports = { STAKES, MemoryWallet, Room, Lobby };
