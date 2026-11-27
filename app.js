'use strict';

// ---------- constants ----------
const LEVELS = 5;          // levels per game
const QUESTIONS = 5;       // questions per level

// ---------- state & helpers ----------
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let soundOn = store.get('sound', true);
// players = [{ id, name, avatar, score, progress: { [game]: { unlocked, best: { [level]: stars } } } }]
let players = store.get('players', []);
let currentId = store.get('currentPlayer', null);
const AVATARS = ['🐶', '🐱', '🐰', '🐼', '🦁', '🐸', '🐵', '🦄', '🐯', '🐨'];
const me = () => players.find((p) => p.id === currentId) || null;
const savePlayers = () => { store.set('players', players); store.set('currentPlayer', currentId); };
let session = null;        // { game, level, q, mistakes, last }
let locked = false;
let timers = [];

const rand = (n) => Math.floor(Math.random() * n);
const randInt = (a, b) => a + rand(b - a + 1);
const pick = (arr) => arr[rand(arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (arr, n) => shuffle(arr).slice(0, n);
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of [].concat(children)) e.append(c);
  return e;
}

// pick an answer different from the previous question in this level
function fresh(gen) {
  for (let i = 0; i < 20; i++) {
    const v = gen();
    const key = JSON.stringify(v);
    if (key !== session.last) { session.last = key; return v; }
  }
  return gen();
}

// ---------- sound ----------
let ctx;
function tone(freq, dur = 0.15, when = 0, type = 'sine') {
  if (!soundOn) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur);
  } catch {}
}
const sfxGood = () => { tone(660); tone(880, 0.2, 0.12); };
const sfxBad = () => tone(200, 0.3, 0, 'square');
const sfxWin = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, i * 0.12, 'triangle'));

let thaiVoice = null;
function loadVoice() {
  if (!('speechSynthesis' in window)) return;
  thaiVoice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('th')) || null;
}
if ('speechSynthesis' in window) { loadVoice(); speechSynthesis.onvoiceschanged = loadVoice; }
function say(text) {
  if (!soundOn || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH'; u.rate = 0.85; u.pitch = 1.2;
    if (thaiVoice) u.voice = thaiVoice;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- UI ----------
function updateStars() {
  const p = me();
  $('stars').textContent = p ? p.score : 0;
  $('playerBtn').classList.toggle('hidden', !p);
  if (p) $('playerBtn').textContent = `${p.avatar} ${p.name}`;
  savePlayers();
}
function updateSoundBtn() { $('soundBtn').textContent = soundOn ? '🔊' : '🔇'; }

function cheer(emoji) {
  const c = $('cheer');
  c.textContent = emoji;
  c.classList.remove('hidden');
  c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  setTimeout(() => c.classList.add('hidden'), 900);
}

function setPrompt(text, speakText) {
  const p = $('prompt');
  p.replaceChildren(el('span', { textContent: text }));
  if (speakText) {
    p.append(el('button', { className: 'speak', textContent: '🔈', ariaLabel: 'ฟังอีกครั้ง', onclick: () => say(speakText) }));
    say(speakText);
  }
}

function setBoard(children, cls = '') {
  const b = $('board');
  b.className = 'board ' + cls;
  b.replaceChildren(...[].concat(children));
}

function renderDots() {
  $('levelLabel').textContent = `ด่าน ${session.level} · ข้อ ${Math.min(session.q + 1, QUESTIONS)}/${QUESTIONS}`;
  $('dots').replaceChildren(...Array.from({ length: QUESTIONS }, (_, i) =>
    el('span', { className: i < session.q ? 'done' : i === session.q ? 'now' : '' })));
}

function wrong() { session.mistakes++; sfxBad(); }

// Called when a question is answered correctly. Advances the level.
function right(afterSay) {
  session.q++;
  me().score++; updateStars(); sfxGood();
  cheer(pick(['👍', '😄', '✨', '💯', '🌟']));
  renderDots();
  later(() => {
    if (afterSay) say(afterSay);
    later(() => (session.q >= QUESTIONS ? finishLevel() : nextQuestion()), afterSay ? 700 : 0);
  }, 900);
}

// Generic multiple choice: options = [{label, value, small?, style?, node?}], answer = value
function choices(options, answer, afterSay) {
  const box = $('choices');
  const n = options.length;
  box.className = 'choices ' + (n === 2 ? 'two' : n === 3 ? 'three' : n === 6 ? 'three' : 'four');
  box.replaceChildren();
  locked = false;
  for (const o of options) {
    const b = el('button', { className: 'choice' + (o.style ? ' swatch' : '') });
    if (o.style) { b.style.background = o.style; b.ariaLabel = o.value; }
    if (o.node) b.append(o.node); else b.append(o.label ?? '');
    if (o.small) b.append(el('small', { textContent: o.small }));
    b.onclick = () => {
      if (locked) return;
      if (o.value === answer) { locked = true; b.classList.add('good'); right(afterSay); }
      else { wrong(); b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 450); }
    };
    box.append(b);
  }
}

// ---------- data ----------
const ITEMS = ['🍎', '🍌', '🍓', '🍊', '🍉', '🍇', '🐶', '🐱', '🐟', '🚗', '🎈', '⭐', '🐤', '🌸'];
const THAI_NUM = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ',
  'สิบเอ็ด', 'สิบสอง', 'สิบสาม', 'สิบสี่', 'สิบห้า', 'สิบหก', 'สิบเจ็ด', 'สิบแปด', 'สิบเก้า', 'ยี่สิบ'];

// answer + distractors near the answer
function numberOptions(ans, count, min = 1, max = 20, spread = 3) {
  const set = new Set([ans]);
  let tries = 0;
  while (set.size < count && tries++ < 200) {
    const v = ans + randInt(-spread, spread);
    if (v >= min && v <= max) set.add(v);
  }
  for (let v = min; set.size < count; v++) set.add(v);
  return shuffle([...set]).map((n) => ({ label: String(n), value: n }));
}

const COLORS = [
  ['แดง', '#ff3b3b'], ['เขียว', '#2ecc40'], ['น้ำเงิน', '#1e6fff'], ['เหลือง', '#ffd400'],
  ['ส้ม', '#ff8c1a'], ['ม่วง', '#9b4dff'], ['ชมพู', '#ff7ac0'], ['น้ำตาล', '#8b5a2b'],
  ['ดำ', '#222222'], ['ขาว', '#ffffff'],
];
const COLOR_OBJECTS = [
  ['🍌', 'กล้วย', 'เหลือง'], ['🍎', 'แอปเปิ้ล', 'แดง'], ['🥦', 'บรอกโคลี', 'เขียว'], ['🍆', 'มะเขือ', 'ม่วง'],
  ['🥕', 'แครอท', 'ส้ม'], ['🐷', 'หมู', 'ชมพู'], ['🐻', 'หมี', 'น้ำตาล'], ['☁️', 'เมฆ', 'ขาว'],
  ['🍓', 'สตรอว์เบอร์รี', 'แดง'], ['🌽', 'ข้าวโพด', 'เหลือง'], ['🍇', 'องุ่น', 'ม่วง'], ['🐸', 'กบ', 'เขียว'],
  ['🍊', 'ส้ม', 'ส้ม'], ['🎱', 'ลูกบอล', 'ดำ'], ['🥥', 'มะพร้าว', 'น้ำตาล'], ['💙', 'หัวใจ', 'น้ำเงิน'],
];

// regular polygon points in a 100x100 box
function poly(n, r = 42, rot = -90, inner = 0) {
  const pts = [];
  const total = inner ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const rr = inner && i % 2 ? inner : r;
    const a = ((rot + (360 / total) * i) * Math.PI) / 180;
    pts.push(`${(50 + rr * Math.cos(a)).toFixed(1)},${(50 + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}
const SHAPES = [
  ['วงกลม', '<circle cx="50" cy="50" r="42"/>'],
  ['สามเหลี่ยม', '<polygon points="50,8 93,86 7,86"/>'],
  ['สี่เหลี่ยมจัตุรัส', '<rect x="12" y="12" width="76" height="76"/>'],
  ['ดาว', poly(5, 46, -90, 19)],
  ['หัวใจ', '<path d="M50 88 C12 60 4 34 22 20 C36 9 50 20 50 32 C50 20 64 9 78 20 C96 34 88 60 50 88Z"/>'],
  ['สี่เหลี่ยมผืนผ้า', '<rect x="4" y="27" width="92" height="46"/>'],
  ['วงรี', '<ellipse cx="50" cy="50" rx="46" ry="28"/>'],
  ['ข้าวหลามตัด', '<polygon points="50,4 84,50 50,96 16,50"/>'],
  ['ห้าเหลี่ยม', poly(5)],
  ['หกเหลี่ยม', poly(6, 44, 0)],
];
const SHAPE_COLORS = ['#ff5a5a', '#1e88ff', '#2ecc40', '#ffb300', '#9b4dff', '#ff7ac0', '#ff8c1a'];
function shapeSvg(name, color, rotate = 0, cls = '') {
  const s = SHAPES.find(([n]) => n === name)[1];
  const span = el('span');
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 100 100" fill="${color}" aria-label="${name}">` +
    `<g transform="rotate(${rotate} 50 50)">${s}</g></svg>`;
  return span.firstChild;
}

const THAI = [
  ['ก', 'ไก่', '🐔'], ['ข', 'ไข่', '🥚'], ['ค', 'ควาย', '🐃'], ['ฆ', 'ระฆัง', '🔔'], ['ง', 'งู', '🐍'],
  ['จ', 'จาน', '🍽️'], ['ช', 'ช้าง', '🐘'], ['ซ', 'โซ่', '⛓️'], ['ญ', 'หญิง', '👩'], ['ด', 'เด็ก', '🧒'],
  ['ต', 'เต่า', '🐢'], ['ถ', 'ถุง', '🛍️'], ['ท', 'ทหาร', '💂'], ['ธ', 'ธง', '🚩'], ['น', 'หนู', '🐭'],
  ['บ', 'ใบไม้', '🍃'], ['ป', 'ปลา', '🐟'], ['ผ', 'ผึ้ง', '🐝'], ['ฟ', 'ฟัน', '🦷'], ['ภ', 'สำเภา', '⛵'],
  ['ม', 'ม้า', '🐴'], ['ย', 'ยักษ์', '👹'], ['ร', 'เรือ', '🚤'], ['ล', 'ลิง', '🐒'], ['ว', 'แหวน', '💍'],
  ['ษ', 'ฤๅษี', '🧙'], ['ส', 'เสือ', '🐯'], ['ห', 'หีบ', '📦'], ['ฬ', 'จุฬา', '🪁'], ['อ', 'อ่าง', '🛁'],
  ['ฮ', 'นกฮูก', '🦉'],
];

// ---------- games ----------
// Each game: title, desc[level-1], round(level) builds one question.
const games = {
  count: {
    title: 'นับเลข',
    desc: ['1–3', '1–5', '1–10', '6–15', 'นับเฉพาะที่บอก'],
    round(lv) {
      const ranges = [[1, 3], [1, 5], [1, 10], [6, 15], [5, 15]];
      const opts = [3, 3, 4, 4, 4][lv - 1];
      const n = fresh(() => randInt(...ranges[lv - 1]));
      const item = pick(ITEMS);
      let cells = Array.from({ length: n }, () => item);
      if (lv === 5) {
        const other = pick(ITEMS.filter((x) => x !== item));
        cells = shuffle([...cells, ...Array.from({ length: randInt(3, 6) }, () => other)]);
        setPrompt(`นับเฉพาะ ${item} มีกี่อัน?`, 'นับเฉพาะอันที่บอกนะ มีกี่อัน');
      } else {
        setPrompt('มีกี่อัน?', 'นับดูสิ มีกี่อัน');
      }
      setBoard(cells.map((c) => el('span', { textContent: c })), cells.length > 10 ? 'small' : '');
      choices(numberOptions(n, opts, 1, 20, lv <= 2 ? 2 : 3), n, THAI_NUM[n]);
    },
  },

  math: {
    title: 'บวกลบเลข',
    desc: ['บวก ไม่เกิน 5', 'บวก ไม่เกิน 10', 'ลบ ไม่เกิน 10', 'บวก ไม่เกิน 20', 'บวก/ลบ ไม่เกิน 20'],
    round(lv) {
      const q = fresh(() => {
        let op = lv === 3 ? '-' : lv === 5 ? pick(['+', '-']) : '+';
        const max = [5, 10, 10, 20, 20][lv - 1];
        if (lv >= 4) { // harder: answers/operands above 10
          if (op === '+') { const a = randInt(4, 15); return { a, b: randInt(Math.max(1, 11 - a), 20 - a), op }; }
          const a = randInt(11, 20); return { a, b: randInt(1, a - 1), op };
        }
        if (op === '+') { const a = randInt(1, max - 1); return { a, b: randInt(1, max - a), op }; }
        const a = randInt(2, max); return { a, b: randInt(1, a - 1), op };
      });
      const { a, b, op } = q;
      const ans = op === '+' ? a + b : a - b;
      const word = op === '+' ? 'บวก' : 'ลบ';
      setPrompt(`${a} ${op === '+' ? '+' : '−'} ${b} = ?`, `${THAI_NUM[a]} ${word} ${THAI_NUM[b]} ได้เท่าไร`);
      if (lv <= 3) {
        const item = pick(ITEMS);
        const group = (k) => el('span', { textContent: item.repeat(k) });
        setBoard([group(a), el('span', { className: 'eq', textContent: op === '+' ? '+' : '−' }), group(b)], a + b > 8 ? 'small' : '');
      } else {
        setBoard(el('span', { className: 'huge', textContent: `${a}${op === '+' ? '+' : '−'}${b}` }));
      }
      choices(numberOptions(ans, 4, 0, 20, 3), ans, `${THAI_NUM[a]} ${word} ${THAI_NUM[b]} ได้ ${THAI_NUM[ans]}`);
    },
  },

  memory: {
    title: 'จับคู่ภาพ',
    desc: ['ผลไม้ ดูก่อน 3 วิ', 'สัตว์ ดูก่อน 2 วิ', 'ยานพาหนะ ดูก่อน 1 วิ', 'หน้ายิ้มคล้ายกัน', 'จำเอง ไม่มีให้ดู'],
    pools: [
      ['🍎', '🍌', '🍇', '🍉', '🍓', '🍊', '🍍'],
      ['🐶', '🐱', '🐰', '🐼', '🦁', '🐸', '🐵', '🐧'],
      ['🚗', '🚌', '🚲', '✈️', '🚀', '🚂', '🚁', '⛵'],
      ['😀', '😃', '😄', '😁', '😆', '😊', '🙂'],
      ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤'],
    ],
    // one board per level: 5 pairs, each pair = one question
    round(lv) {
      setPrompt('หาภาพที่เหมือนกัน', 'หาภาพที่เหมือนกันให้ครบห้าคู่นะ');
      $('choices').replaceChildren();
      const preview = [3000, 2000, 1000, 1000, 0][lv - 1];
      const cards = shuffle(sample(this.pools[lv - 1], QUESTIONS).flatMap((e) => [e, e]));
      const grid = el('div', { className: 'memory five' });
      let first = null, busy = preview > 0;
      const btns = cards.map((e) => {
        const c = el('button', { className: 'mcard' + (preview ? ' open' : ''), ariaLabel: 'การ์ด' }, [
          el('span', { className: 'back', textContent: '?' }),
          el('span', { className: 'face', textContent: e }),
        ]);
        c.dataset.face = e;
        c.onclick = () => {
          if (busy || c === first || c.classList.contains('done')) return;
          c.classList.add('open'); tone(520, 0.08);
          if (!first) { first = c; return; }
          if (first.dataset.face === e) {
            first.classList.add('done'); c.classList.add('done'); first = null;
            busy = session.q + 1 >= QUESTIONS;
            right();
          } else {
            wrong(); busy = true; const f = first; first = null;
            later(() => { f.classList.remove('open'); c.classList.remove('open'); busy = false; }, 800);
          }
        };
        grid.append(c);
        return c;
      });
      if (preview) later(() => { btns.forEach((b) => b.classList.remove('open')); busy = false; }, preview);
      setBoard(grid);
    },
  },

  color: {
    title: 'ทายสี',
    desc: ['4 สีหลัก', '6 สี', '10 สี', '10 สี 6 ตัวเลือก', 'ของสิ่งนี้สีอะไร'],
    round(lv) {
      if (lv === 5) {
        const [emoji, thing, colorName] = fresh(() => pick(COLOR_OBJECTS));
        const others = sample(COLORS.filter(([n]) => n !== colorName), 3);
        const opts = shuffle([COLORS.find(([n]) => n === colorName), ...others]);
        setPrompt(`${thing}สีอะไร?`, `${thing}สีอะไร`);
        setBoard(el('span', { className: 'huge', textContent: emoji }));
        choices(opts.map(([n, c]) => ({ value: n, style: c })), colorName, `${thing}สี${colorName}`);
        return;
      }
      const pool = COLORS.slice(0, [4, 6, 10, 10][lv - 1]);
      const n = [2, 3, 4, 6][lv - 1];
      const name = fresh(() => pick(pool)[0]);
      const opts = shuffle([COLORS.find(([x]) => x === name), ...sample(pool.filter(([x]) => x !== name), n - 1)]);
      setPrompt(`แตะสี${name}`, `แตะสี${name}`);
      setBoard(el('span', { className: 'huge', textContent: '🎨' }));
      choices(opts.map(([x, c]) => ({ value: x, style: c })), name, `สี${name}`);
    },
  },

  shape: {
    title: 'รูปทรง',
    desc: ['3 รูปทรง', '5 รูปทรง', '7 รูปทรง', '10 รูปทรง', 'สีและมุมหลอกตา'],
    round(lv) {
      const pool = SHAPES.slice(0, [3, 5, 7, 10, 10][lv - 1]).map(([n]) => n);
      const n = [2, 3, 4, 4, 6][lv - 1];
      const name = fresh(() => pick(pool));
      const opts = shuffle([name, ...sample(pool.filter((x) => x !== name), n - 1)]);
      const sameColor = lv <= 2 ? pick(SHAPE_COLORS) : null;
      setPrompt(`รูป${name} อยู่ไหน?`, `รูป${name} อยู่ไหน`);
      setBoard(el('span', { className: 'huge', textContent: '🔍' }));
      choices(opts.map((x) => ({
        value: x,
        node: shapeSvg(x, sameColor || pick(SHAPE_COLORS), lv === 5 ? pick([0, 15, 30, 45, 90]) : 0),
      })), name, `รูป${name}`);
    },
  },

  thai: {
    title: 'ก ไก่ - ฮ นกฮูก',
    desc: ['ก – ซ', 'ญ – น', 'บ – ภ', 'ม – ฮ', 'ดูภาพ หาตัวอักษร'],
    round(lv) {
      const slices = [[0, 8], [8, 15], [15, 20], [20, 31], [0, 31]];
      const pool = THAI.slice(...slices[lv - 1]);
      const [ch, word, emoji] = fresh(() => pick(pool));
      // distractors: prefer the same group, fall back to the whole alphabet
      const others = sample(pool.filter(([c]) => c !== ch), 3);
      while (others.length < 3) {
        const x = pick(THAI);
        if (x[0] !== ch && !others.includes(x)) others.push(x);
      }
      const opts = shuffle([[ch, word, emoji], ...others]);
      if (lv === 5) {
        setPrompt(`${word} ... ตัวอะไร?`, `${word} ตัวอะไรเอ่ย`);
        setBoard(el('span', { className: 'huge', textContent: emoji }));
        choices(opts.map(([c]) => ({ label: c, value: c })), ch, `${ch} ${word}`);
      } else {
        setPrompt(`${ch} ... อะไรนะ?`, `${ch} อะไรเอ่ย`);
        setBoard(el('span', { className: 'huge', textContent: ch }));
        choices(opts.map(([, w, e]) => ({ label: e, small: w, value: w })), word, `${ch} ${word}`);
      }
    },
  },
};

// ---------- sliding puzzle (3x3) ----------
const PICTURES = [
  { main: '🐶', bg: '#bde0fe', deco: ['☀️', '☁️', '🌼', '🦴'] },
  { main: '🐱', bg: '#ffd6e0', deco: ['🌙', '⭐', '🧶', '🐟'] },
  { main: '🦁', bg: '#ffe8a3', deco: ['☀️', '🌴', '🌿', '🍖'] },
  { main: '🐼', bg: '#d8f3dc', deco: ['🎋', '☁️', '🍃', '🌱'] },
  { main: '🐸', bg: '#c7f0ff', deco: ['🌧️', '🦋', '🪷', '💧'] },
  { main: '🦄', bg: '#e9d5ff', deco: ['🌈', '✨', '🌸', '💖'] },
  { main: '🐵', bg: '#ffe0c2', deco: ['🌳', '☀️', '🍌', '🍃'] },
  { main: '🚀', bg: '#1d2b53', deco: ['🌙', '⭐', '🪐', '✨'] },
  { main: '🐢', bg: '#a8e6cf', deco: ['☀️', '🐚', '🌊', '🦀'] },
  { main: '🍉', bg: '#fff3b0', deco: ['☀️', '🍓', '🍒', '🍋'] },
];
const BANDS = ['#ffffff55', '#00000014', '#ffffff33'];
// picture artwork drawn in a 300x300 box (shared by slide and jigsaw)
function picInner(pic) {
  const [a, b, c, d] = pic.deco;
  return `<rect width="300" height="300" fill="${pic.bg}"/>` +
    BANDS.map((f, i) => `<rect y="${i * 100}" width="300" height="100" fill="${f}"/>`).join('') +
    `<circle cx="150" cy="160" r="92" fill="#ffffff66"/>` +
    `<g font-size="56" text-anchor="middle" dominant-baseline="central">` +
    `<text x="50" y="50">${a}</text><text x="250" y="50">${b}</text>` +
    `<text x="50" y="250">${c}</text><text x="250" y="250">${d}</text></g>` +
    `<text x="150" y="158" font-size="150" text-anchor="middle" dominant-baseline="central">${pic.main}</text>`;
}
function svgNode(markup) {
  const span = el('span');
  span.innerHTML = markup;
  return span.firstChild;
}
function pictureSvg(pic, viewBox = '0 0 300 300') {
  return svgNode(`<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${picInner(pic)}</svg>`);
}
const neighbors = (p) => {
  const r = Math.floor(p / 3), c = p % 3, out = [];
  if (r > 0) out.push(p - 3); if (r < 2) out.push(p + 3);
  if (c > 0) out.push(p - 1); if (c < 2) out.push(p + 1);
  return out;
};

games.slide = {
  title: 'สไลด์ภาพ',
  desc: ['เลื่อน 3 ที มีเลขช่วย', 'เลื่อน 6 ที มีเลขช่วย', 'เลื่อน 10 ที มีเลขช่วย', 'เลื่อน 16 ที ไม่มีเลข', 'สลับมั่ว ไม่มีเลข'],
  round(lv) {
    const depth = [3, 6, 10, 16, 40][lv - 1];
    const showNums = lv <= 3;
    const pic = fresh(() => pick(PICTURES));
    // tiles[pos] = tile id (0..7), 8 = blank; solved when tiles[i] === i
    let tiles, blank;
    do {
      tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8]; blank = 8;
      let prev = -1;
      for (let k = 0; k < depth; k++) {
        const n = pick(neighbors(blank).filter((x) => x !== prev));
        [tiles[blank], tiles[n]] = [tiles[n], tiles[blank]];
        prev = blank; blank = n;
      }
    } while (tiles.every((t, i) => t === i));

    const preview = el('span', { className: 'preview' }, pictureSvg(pic));
    $('prompt').replaceChildren(preview, el('span', { textContent: 'เลื่อนให้เป็นภาพนี้' }));
    say('เลื่อนช่องให้เป็นภาพเหมือนตัวอย่างนะ');
    $('choices').replaceChildren();

    const grid = el('div', { className: 'slide' });
    const moves = el('div', { className: 'moves', textContent: 'เลื่อนแล้ว 0 ที' });
    let count = 0, done = false;
    const nodes = [];
    for (let id = 0; id < 8; id++) {
      const r = Math.floor(id / 3), c = id % 3;
      const t = el('button', { className: 'tile', ariaLabel: `ช่อง ${id + 1}` },
        [pictureSvg(pic, `${c * 100} ${r * 100} 100 100`)]);
      if (showNums) t.append(el('span', { className: 'n', textContent: id + 1 }));
      t.onclick = () => move(id);
      nodes[id] = t; grid.append(t);
    }
    const place = () => tiles.forEach((id, pos) => {
      if (id === 8) return;
      nodes[id].style.transform = `translate(${(pos % 3) * 100}%, ${Math.floor(pos / 3) * 100}%)`;
    });
    function move(id) {
      if (done) return;
      const pos = tiles.indexOf(id);
      if (!neighbors(pos).includes(blank)) { tone(180, 0.08, 0, 'square'); return; }
      [tiles[pos], tiles[blank]] = [tiles[blank], tiles[pos]];
      blank = pos; count++;
      moves.textContent = `เลื่อนแล้ว ${count} ที`;
      tone(440 + rand(200), 0.06); place();
      if (tiles.every((t, i) => t === i)) {
        done = true;
        // too many moves for this level counts as one mistake (affects level stars)
        if (count > Math.min(depth, 22) * 2 + 4) session.mistakes++;
        const last = el('button', { className: 'tile' }, [pictureSvg(pic, '200 200 100 100')]);
        last.style.transform = 'translate(200%, 200%)';
        later(() => { grid.append(last); grid.classList.add('solved'); }, 200);
        right(`เก่งมาก เลื่อน ${count} ที`);
      }
    }
    place();
    setBoard([grid, moves]);
  },
};

// ---------- jigsaw ----------
// Each cell is 100 units; tabs stick out up to 22 units, so a piece is drawn in a 150x150 box.
const JM = 25;
function jigsawEdge(ax, ay, bx, by, s) {
  if (!s) return `L${bx},${by}`;
  const dx = (bx - ax) / 100, dy = (by - ay) / 100;
  const nx = dy * s, ny = -dx * s; // outward normal (clockwise path)
  const P = (t, h) => `${(ax + dx * t * 100 + nx * h * 100).toFixed(1)},${(ay + dy * t * 100 + ny * h * 100).toFixed(1)}`;
  return `L${P(0.35, 0)} C${P(0.4, 0)} ${P(0.28, 0.22)} ${P(0.5, 0.22)} C${P(0.72, 0.22)} ${P(0.6, 0)} ${P(0.65, 0)} L${P(1, 0)}`;
}
function jigsawPath(r, c, rows, cols, hE, vE) {
  const x = c * 100, y = r * 100;
  return `M${x},${y} ` +
    jigsawEdge(x, y, x + 100, y, r === 0 ? 0 : -vE[r - 1][c]) + ' ' +
    jigsawEdge(x + 100, y, x + 100, y + 100, c === cols - 1 ? 0 : hE[r][c]) + ' ' +
    jigsawEdge(x + 100, y + 100, x, y + 100, r === rows - 1 ? 0 : vE[r][c]) + ' ' +
    jigsawEdge(x, y + 100, x, y, c === 0 ? 0 : -hE[r][c - 1]) + ' Z';
}
let jigsawUid = 0;

games.jigsaw = {
  title: 'ต่อจิ๊กซอว์',
  desc: ['4 ชิ้น มีภาพจาง', '6 ชิ้น มีภาพจาง', '9 ชิ้น มีภาพจาง', '9 ชิ้น ไม่มีภาพจาง', '12 ชิ้น ไม่มีภาพจาง'],
  round(lv) {
    const [rows, cols] = [[2, 2], [2, 3], [3, 3], [3, 3], [3, 4]][lv - 1];
    const ghost = lv <= 3;
    const W = cols * 100, H = rows * 100;
    const pic = fresh(() => pick(PICTURES));
    const uid = ++jigsawUid;
    const sign = () => (rand(2) ? 1 : -1);
    const hE = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, sign));
    const vE = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, sign));
    // artwork stretched (cropped, not distorted) to the board size
    const art = `<rect width="${W}" height="${H}" fill="${pic.bg}"/>` +
      `<svg width="${W}" height="${H}" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice">${picInner(pic)}</svg>`;

    $('prompt').replaceChildren(el('span', { className: 'preview' }, pictureSvg(pic)), el('span', { textContent: 'ต่อภาพให้ครบ' }));
    say('ลากชิ้นส่วนไปวางให้ถูกที่นะ');
    $('choices').replaceChildren();

    const board = el('div', { className: 'jig-board' });
    board.style.aspectRatio = `${cols} / ${rows}`;
    if (rows === 3 && cols === 3) board.style.width = 'min(290px, 76vw)';
    const outlines = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) outlines.push(jigsawPath(r, c, rows, cols, hE, vE));
    board.append(svgNode(`<svg class="jig-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      (ghost ? `<g opacity=".28">${art}</g>` : '') +
      outlines.map((d) => `<path d="${d}" fill="none" stroke="#c9b79c" stroke-width="2" stroke-dasharray="6 5"/>`).join('') +
      `</svg>`));
    const tray = el('div', { className: 'jig-tray' });
    const status = el('div', { className: 'moves', textContent: `0/${rows * cols} ชิ้น` });

    let placed = 0, done = false, selected = null;
    const pieces = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = outlines[r * cols + c];
      const id = `jz${uid}-${r}-${c}`;
      const x0 = c * 100 - JM, y0 = r * 100 - JM;
      const node = svgNode(`<svg class="jig-piece" viewBox="${x0} ${y0} 150 150">` +
        `<defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs>` +
        `<g clip-path="url(#${id})">${art}</g>` +
        `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.5"/>` +
        `<path d="${d}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/></svg>`);
      const piece = { r, c, node, placed: false };
      node.dataset.slot = `${r}-${c}`;
      node.addEventListener('pointerdown', (e) => startDrag(e, piece));
      pieces.push(piece);
    }
    shuffle(pieces).forEach((p) => tray.append(p.node));

    const cellPx = () => board.clientWidth / cols;
    // smaller tray pieces when there are more of them, so board + tray fit one screen
    tray.dataset.scale = rows * cols <= 6 ? 0.72 : rows * cols <= 9 ? 0.56 : 0.5;
    tray.dataset.cols = cols;
    function sizeTray() {
      tray.style.setProperty('--pw', `${cellPx() * 1.5 * tray.dataset.scale}px`);
    }
    function placePiece(p) {
      p.placed = true; placed++;
      p.node.classList.remove('sel', 'dragging');
      p.node.removeAttribute('style');
      p.node.classList.add('placed');
      Object.assign(p.node.style, {
        left: `${((p.c * 100 - JM) / W) * 100}%`, top: `${((p.r * 100 - JM) / H) * 100}%`,
        width: `${(150 / W) * 100}%`, height: `${(150 / H) * 100}%`,
      });
      board.append(p.node);
      tone(700, 0.08); tone(900, 0.1, 0.06);
      status.textContent = `${placed}/${rows * cols} ชิ้น`;
      if (placed === rows * cols) {
        done = true;
        later(() => board.classList.add('solved'), 150);
        right('เก่งมาก ต่อภาพครบแล้ว');
      }
    }
    function backToTray(p, bad) {
      p.node.classList.remove('dragging');
      p.node.removeAttribute('style');
      tray.append(p.node);
      if (bad) { wrong(); p.node.classList.add('bad'); setTimeout(() => p.node.classList.remove('bad'), 450); }
    }
    // board cell under a screen point, or null
    function cellAt(x, y) {
      const b = board.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null;
      return { r: Math.floor(((y - b.top) / b.height) * rows), c: Math.floor(((x - b.left) / b.width) * cols) };
    }
    function startDrag(e, p) {
      if (done || p.placed) return;
      e.preventDefault();
      const rect = p.node.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const full = cellPx() * 1.5;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        if (!moved) {
          moved = true;
          if (selected) { selected.node.classList.remove('sel'); selected = null; }
          p.node.classList.add('dragging');
          document.body.append(p.node);
        }
        // the piece's cell sits in the middle of its 150-unit box
        Object.assign(p.node.style, {
          width: `${full}px`, height: `${full}px`,
          left: `${ev.clientX - full / 2}px`, top: `${ev.clientY - full / 2}px`,
        });
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!moved) { // tap: select this piece, then tap the board
          if (selected) selected.node.classList.remove('sel');
          selected = selected === p ? null : p;
          if (selected) { p.node.classList.add('sel'); tone(520, 0.06); }
          return;
        }
        const b = board.getBoundingClientRect(), cell = b.width / cols;
        const tx = b.left + (p.c + 0.5) * cell, ty = b.top + (p.r + 0.5) * cell;
        if (Math.hypot(ev.clientX - tx, ev.clientY - ty) < cell * 0.45) placePiece(p);
        else backToTray(p, !!cellAt(ev.clientX, ev.clientY));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      void rect;
    }
    board.addEventListener('pointerup', (e) => {
      if (!selected || done) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const p = selected; selected = null;
      p.node.classList.remove('sel');
      if (cell.r === p.r && cell.c === p.c) placePiece(p);
      else backToTray(p, true);
    });

    setBoard([board, status, tray]);
    sizeTray();
  },
};
window.addEventListener('resize', () => {
  const b = document.querySelector('.jig-board'), t = document.querySelector('.jig-tray');
  if (b && t) t.style.setProperty('--pw', `${(b.clientWidth / t.dataset.cols) * 1.5 * t.dataset.scale}px`);
});

// ---------- odd one out ----------
games.odd = {
  title: 'หาตัวที่ต่าง',
  desc: ['4 ช่อง ต่างกันชัด', '9 ช่อง', '12 ช่อง คล้ายกัน', '16 ช่อง คล้ายมาก', 'ตัวไหนหันคนละทาง'],
  sets: [
    [['🐶', '🍎'], ['🚗', '🌸'], ['⭐', '🐟'], ['🎈', '🐢'], ['🍌', '⚽'], ['🐱', '🚀'], ['🌞', '🍦']],
    [['🍎', '🍌'], ['🐶', '🐱'], ['🚗', '🚌'], ['🌸', '🌻'], ['🐟', '🐙'], ['🍓', '🍇'], ['⚽', '🏀']],
    [['🍎', '🍅'], ['🐶', '🐕'], ['🍊', '🍑'], ['🐤', '🐥'], ['🌸', '🌺'], ['🚗', '🚙'], ['🐻', '🧸'], ['⚽', '🏐']],
    [['😀', '😃'], ['🙂', '😊'], ['🐱', '😺'], ['🌑', '🌚'], ['🧡', '💛'], ['🔵', '🫐'], ['🐵', '🙈'], ['🍏', '🍐']],
    [['🐟'], ['🐌'], ['🚗'], ['🐢'], ['🦆'], ['🐘'], ['🐕'], ['🐊'], ['🦒'], ['🚂'], ['🐓'], ['🚜']],
  ],
  round(lv) {
    const size = [4, 9, 12, 16, 16][lv - 1];
    const cols = [2, 3, 4, 4, 4][lv - 1];
    const set = fresh(() => pick(this.sets[lv - 1]));
    // randomly swap which emoji is the "many" and which is the odd one
    const [same, diff] = lv === 5 ? [set[0], set[0]] : rand(2) ? set : [set[1], set[0]];
    const oddPos = rand(size);
    if (lv === 5) setPrompt('ตัวไหนหันคนละทาง?', 'หาตัวที่หันไปคนละทางนะ');
    else setPrompt('ตัวไหนไม่เหมือนเพื่อน?', 'หาตัวที่ไม่เหมือนเพื่อนนะ');
    $('choices').replaceChildren();
    const grid = el('div', { className: 'odd-grid' });
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.setProperty('--odd-size', ['3.6rem', '3rem', '2.4rem', '2.2rem', '2.2rem'][lv - 1]);
    let done = false;
    for (let i = 0; i < size; i++) {
      const isOdd = i === oddPos;
      const face = el('span', { textContent: isOdd ? diff : same });
      if (lv === 5 && isOdd) face.className = 'flip';
      const b = el('button', { className: 'odd-item', ariaLabel: isOdd ? 'ตัวที่ต่าง' : 'ตัวเหมือน' }, [face]);
      b.onclick = () => {
        if (done) return;
        if (isOdd) { done = true; b.classList.add('good'); right(); }
        else { wrong(); b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 450); }
      };
      grid.append(b);
    }
    setBoard(grid);
  },
};

// ---------- simon (repeat the sequence) ----------
const PADS = [
  { color: '#ff4d4d', icon: '🐶', freq: 262 },
  { color: '#2ecc40', icon: '🐸', freq: 330 },
  { color: '#1e88ff', icon: '🐳', freq: 392 },
  { color: '#ffd400', icon: '🐥', freq: 523 },
  { color: '#b05cff', icon: '🦄', freq: 587 },
  { color: '#ff8c1a', icon: '🦊', freq: 659 },
];
games.simon = {
  title: 'จำลำดับ',
  desc: ['3 ปุ่ม จำ 2 ตัว', '4 ปุ่ม จำ 3 ตัว', '4 ปุ่ม จำ 4 ตัว', '6 ปุ่ม จำ 4 ตัว', '6 ปุ่ม จำ 5 ตัว เร็วขึ้น'],
  round(lv) {
    const nPads = [3, 4, 4, 6, 6][lv - 1];
    const len = [2, 3, 4, 4, 5][lv - 1];
    const speed = [700, 650, 600, 550, 450][lv - 1];
    const pads = PADS.slice(0, nPads);
    const seq = fresh(() => Array.from({ length: len }, () => rand(nPads)));
    let input = 0, playing = true, done = false;

    $('prompt').replaceChildren(el('span', { textContent: 'ดูแล้วกดตามนะ' }),
      el('button', { className: 'speak', textContent: '🔁', ariaLabel: 'ดูอีกครั้ง', onclick: () => { if (!playing && !done) { wrongReplay(false); } } }));
    $('choices').replaceChildren();
    const grid = el('div', { className: 'simon wait' });
    grid.style.gridTemplateColumns = `repeat(${nPads === 4 ? 2 : 3}, 1fr)`;
    const status = el('div', { className: 'simon-status' });
    const dots = el('div', { className: 'simon-seq' }, seq.map(() => el('span')));
    const btns = pads.map((p, i) => {
      const b = el('button', { className: 'pad', textContent: p.icon, ariaLabel: `ปุ่ม ${i + 1}` });
      b.style.background = p.color;
      b.onclick = () => press(i);
      return b;
    });
    grid.append(...btns);

    const flash = (i, ms) => {
      btns[i].classList.add('lit'); tone(pads[i].freq, ms / 1000 * 0.8, 0, 'triangle');
      later(() => btns[i].classList.remove('lit'), ms * 0.7);
    };
    function playSeq(delay = 900) {
      playing = true; input = 0;
      grid.classList.add('wait');
      [...dots.children].forEach((d) => d.classList.remove('ok'));
      status.textContent = '👀 ดูให้ดีนะ...';
      seq.forEach((i, k) => later(() => flash(i, speed), delay + k * speed));
      later(() => {
        playing = false; grid.classList.remove('wait');
        status.textContent = '👆 ถึงตาหนูแล้ว!';
      }, delay + seq.length * speed);
    }
    function wrongReplay(isMistake) {
      if (isMistake) { wrong(); status.textContent = '❌ ไม่ใช่นะ ดูใหม่อีกครั้ง'; }
      playSeq(isMistake ? 1100 : 300);
    }
    function press(i) {
      if (playing || done) return;
      flash(i, 350);
      if (i !== seq[input]) { playing = true; wrongReplay(true); return; }
      dots.children[input].classList.add('ok');
      input++;
      if (input === seq.length) { done = true; status.textContent = '🎉 ถูกต้อง!'; right(); }
    }

    setBoard([grid, dots, status]);
    say('ดูแล้วกดตามนะ');
    playSeq(1200);
  },
};

// ---------- progress ----------
function gp(name) { return (me().progress[name] ||= { unlocked: 1, best: {} }); }
function saveProgress() { savePlayers(); }
function statsOf(p) {
  let passed = 0, trophies = 0;
  for (const g of Object.values(p.progress)) for (const s of Object.values(g.best)) { passed++; trophies += s; }
  return { passed, trophies };
}

// ---------- players & leaderboard ----------
let chosenAvatar = AVATARS[0];

function showPlayers() {
  stopAll();
  show('players', 'ผู้เล่น & คะแนน');
  $('homeBtn').classList.toggle('hidden', !me());
  const ranked = [...players].sort((a, b) => b.score - a.score || statsOf(b).trophies - statsOf(a).trophies);
  $('rankList').replaceChildren(...ranked.map((p, i) => {
    const { passed, trophies } = statsOf(p);
    const total = Object.keys(games).length * LEVELS;
    const del = el('button', { className: 'del', textContent: '🗑️', ariaLabel: `ลบ ${p.name}` });
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`ลบผู้เล่น "${p.name}" และคะแนนทั้งหมด?`)) return;
      players = players.filter((x) => x.id !== p.id);
      if (currentId === p.id) currentId = players[0]?.id ?? null;
      updateStars(); showPlayers();
    };
    const name = el('div', { className: 'name', textContent: p.name });
    if (p.id === currentId) name.append(el('span', { className: 'badge', textContent: 'กำลังเล่น' }));
    const row = el('li', { className: 'rank-row' + (p.id === currentId ? ' me' : '') }, [
      el('span', { className: 'rank', textContent: ['🥇', '🥈', '🥉'][i] || i + 1 }),
      el('span', { className: 'av', textContent: p.avatar }),
      el('div', { className: 'info' }, [name, el('div', { className: 'sub', textContent: `ผ่าน ${passed}/${total} ด่าน · 🏅 ${trophies}` })]),
      el('span', { className: 'score', textContent: `⭐ ${p.score}` }),
      del,
    ]);
    row.onclick = () => selectPlayer(p.id);
    return row;
  }));
  $('newPlayerTitle').textContent = players.length ? 'เพิ่มผู้เล่นใหม่' : 'สวัสดี! หนูชื่ออะไร?';
  chosenAvatar = AVATARS.find((a) => !players.some((p) => p.avatar === a)) || AVATARS[0];
  $('avatarPick').replaceChildren(...AVATARS.map((a) => {
    const b = el('button', { textContent: a, className: a === chosenAvatar ? 'sel' : '', ariaLabel: a });
    b.onclick = () => { chosenAvatar = a; tone(600, 0.08); showAvatarSel(); };
    return b;
  }));
  if (!players.length) say('สวัสดีจ้า หนูชื่ออะไร');
}
function showAvatarSel() {
  [...$('avatarPick').children].forEach((b) => b.classList.toggle('sel', b.textContent === chosenAvatar));
}

function selectPlayer(id) {
  currentId = id; updateStars();
  say(`สวัสดี ${me().name}`);
  showMenu();
}

function addPlayer() {
  const input = $('nameInput');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    input.classList.add('bad'); sfxBad(); say('พิมพ์ชื่อก่อนนะ');
    setTimeout(() => input.classList.remove('bad'), 450);
    input.focus();
    return;
  }
  const existing = players.find((p) => p.name === name);
  if (existing) { input.value = ''; selectPlayer(existing.id); return; }
  const p = { id: Date.now().toString(36) + rand(1000), name, avatar: chosenAvatar, score: 0, progress: {} };
  // carry over scores saved before player profiles existed
  if (!players.length) {
    p.score = store.get('stars', 0);
    p.progress = store.get('progress', {});
    try { localStorage.removeItem('stars'); localStorage.removeItem('progress'); } catch {}
  }
  players.push(p);
  input.value = '';
  selectPlayer(p.id);
}
function starsFor(mistakes) { return mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1; }

// ---------- screens ----------
let currentGame = null;
function show(screen, title) {
  for (const s of ['menu', 'levels', 'game', 'result', 'players']) $(s).classList.toggle('hidden', s !== screen);
  $('homeBtn').classList.toggle('hidden', screen === 'menu');
  $('title').textContent = title || 'เกมหนูน้อย';
  window.scrollTo(0, 0);
}

function stopAll() {
  clearTimers();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function showMenu() { stopAll(); session = null; show('menu'); }

function showLevels(name) {
  if (!me()) return showPlayers();
  stopAll();
  currentGame = name;
  const g = games[name], p = gp(name);
  show('levels', g.title);
  $('levelGrid').replaceChildren(...Array.from({ length: LEVELS }, (_, i) => {
    const lv = i + 1, isLocked = lv > p.unlocked, best = p.best[lv] || 0;
    const b = el('button', { className: 'level-btn' + (isLocked ? ' locked' : '') }, [
      el('span', { className: 'num', textContent: isLocked ? '🔒' : lv }),
      el('span', { className: 'lvl-stars', textContent: best ? '⭐'.repeat(best) + '☆'.repeat(3 - best) : isLocked ? '' : '☆☆☆' }),
      el('span', { className: 'lvl-desc', textContent: `ด่าน ${lv} · ${g.desc[i]}` }),
    ]);
    b.onclick = () => { if (isLocked) { sfxBad(); say('ผ่านด่านก่อนหน้าก่อนนะ'); } else startLevel(name, lv); };
    return b;
  }));
}

function startLevel(name, level) {
  stopAll();
  currentGame = name;
  session = { game: name, level, q: 0, mistakes: 0, last: null };
  show('game', games[name].title);
  nextQuestion(true);
}

function nextQuestion(first) {
  renderDots();
  const g = games[session.game];
  if (session.game === 'memory' && !first) return; // memory: one board per level
  g.round(session.level);
}

function finishLevel() {
  const { game, level, mistakes } = session;
  const p = gp(game), s = starsFor(mistakes);
  p.best[level] = Math.max(p.best[level] || 0, s);
  if (level < LEVELS) p.unlocked = Math.max(p.unlocked, level + 1);
  saveProgress();
  sfxWin();
  const last = level === LEVELS;
  $('resultEmoji').textContent = last ? '🏆' : pick(['🎉', '🥳', '🎈', '🌈']);
  $('resultTitle').textContent = last ? 'ผ่านครบทุกด่านแล้ว!' : `ผ่านด่าน ${level} แล้ว!`;
  $('resultStars').textContent = '⭐'.repeat(s) + '☆'.repeat(3 - s);
  $('resultText').textContent = mistakes === 0 ? 'ไม่ผิดเลยสักข้อ เก่งมาก!' : `ตอบผิด ${mistakes} ครั้ง ลองใหม่ให้ได้ 3 ดาวนะ`;
  $('nextLevelBtn').classList.toggle('hidden', last);
  show('result', games[game].title);
  say(last ? 'ยอดเยี่ยม ผ่านครบทุกด่านแล้ว' : `เก่งมาก ผ่านด่าน${THAI_NUM[level]}แล้ว`);
}

// ---------- wiring ----------
document.querySelectorAll('.game-card[data-game]').forEach((b) => (b.onclick = () => showLevels(b.dataset.game)));
$('rankCard').onclick = showPlayers;
$('playerBtn').onclick = showPlayers;
$('addPlayerBtn').onclick = addPlayer;
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
$('homeBtn').onclick = () => (me() ? showMenu() : showPlayers());
$('nextLevelBtn').onclick = () => startLevel(session.game, session.level + 1);
$('replayBtn').onclick = () => startLevel(session.game, session.level);
$('levelsBtn').onclick = () => showLevels(session.game);
$('soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); updateSoundBtn(); };
if (!me() && players.length) currentId = players[0].id;
updateStars(); updateSoundBtn();
if (!me()) showPlayers();

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; $('installBtn').classList.remove('hidden');
});
$('installBtn').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; $('installBtn').classList.add('hidden');
};
