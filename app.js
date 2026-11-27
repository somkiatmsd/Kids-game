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
let stars = store.get('stars', 0);
let soundOn = store.get('sound', true);
// progress[game] = { unlocked: n, best: { [level]: starCount } }
const progress = store.get('progress', {});
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
function updateStars() { $('stars').textContent = stars; store.set('stars', stars); }
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
  stars++; updateStars(); sfxGood();
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
        const c = el('button', { className: 'mcard' + (preview ? ' open' : ''), textContent: e, ariaLabel: 'การ์ด' });
        c.onclick = () => {
          if (busy || c === first || c.classList.contains('done')) return;
          c.classList.add('open'); tone(520, 0.08);
          if (!first) { first = c; return; }
          if (first.textContent === e) {
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

// ---------- progress ----------
function gp(name) { return (progress[name] ||= { unlocked: 1, best: {} }); }
function saveProgress() { store.set('progress', progress); }
function starsFor(mistakes) { return mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1; }

// ---------- screens ----------
let currentGame = null;
function show(screen, title) {
  for (const s of ['menu', 'levels', 'game', 'result']) $(s).classList.toggle('hidden', s !== screen);
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
document.querySelectorAll('.game-card').forEach((b) => (b.onclick = () => showLevels(b.dataset.game)));
$('homeBtn').onclick = showMenu;
$('nextLevelBtn').onclick = () => startLevel(session.game, session.level + 1);
$('replayBtn').onclick = () => startLevel(session.game, session.level);
$('levelsBtn').onclick = () => showLevels(session.game);
$('soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); updateSoundBtn(); };
updateStars(); updateSoundBtn();

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
