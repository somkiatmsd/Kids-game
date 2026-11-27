'use strict';

// ---------- state & helpers ----------
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let stars = store.get('stars', 0);
let soundOn = store.get('sound', true);
let streak = 0;
let locked = false;

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (arr, n) => shuffle(arr).slice(0, n);

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of [].concat(children)) e.append(c);
  return e;
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

function reward() {
  stars++; streak++; updateStars(); sfxGood();
  if (streak % 5 === 0) { sfxWin(); cheer(pick(['🎉', '🏆', '🌟', '🥳', '🎈'])); say(pick(['เก่งมาก', 'ยอดเยี่ยม', 'สุดยอดเลย'])); }
  else cheer(pick(['👍', '😄', '✨', '💯']));
}

// Generic multiple choice: options = [{label, value, small?, style?}], answer = value
function choices(options, answer, next, { four = false } = {}) {
  const box = $('choices');
  box.className = 'choices' + (four ? ' four' : '');
  box.replaceChildren();
  locked = false;
  for (const o of options) {
    const b = el('button', { className: 'choice' + (o.style ? ' swatch' : '') });
    if (o.style) b.style.background = o.style;
    b.append(o.label ?? '');
    if (o.small) b.append(el('small', { textContent: o.small }));
    b.onclick = () => {
      if (locked) return;
      if (o.value === answer) {
        locked = true; b.classList.add('good'); reward();
        setTimeout(next, 1000);
      } else {
        streak = 0; b.classList.add('bad'); sfxBad();
        setTimeout(() => b.classList.remove('bad'), 450);
      }
    };
    box.append(b);
  }
}

// ---------- games ----------
const FRUITS = ['🍎', '🍌', '🍓', '🍊', '🍉', '🍇', '🐶', '🐱', '🐟', '🚗', '🎈', '⭐'];
const THAI_NUM = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ'];

function numberOptions(ans, max) {
  const set = new Set([ans]);
  while (set.size < 4) set.add(1 + rand(max));
  return shuffle([...set]).map((n) => ({ label: String(n), value: n }));
}

const games = {
  count: {
    title: 'นับเลข',
    round() {
      const n = 1 + rand(10), item = pick(FRUITS);
      setPrompt('มีกี่อัน?', 'นับดูสิ มีกี่อัน');
      $('board').replaceChildren(...Array.from({ length: n }, () => el('span', { textContent: item })));
      choices(numberOptions(n, 10), n, () => { say(THAI_NUM[n]); games.count.round(); }, { four: true });
    },
  },

  math: {
    title: 'บวกเลข',
    round() {
      const a = 1 + rand(5), b = 1 + rand(5), item = pick(FRUITS);
      setPrompt(`${a} + ${b} = ?`, `${THAI_NUM[a]} บวก ${THAI_NUM[b]} ได้เท่าไร`);
      const group = (k) => el('span', { textContent: item.repeat(k) });
      $('board').replaceChildren(group(a), el('span', { className: 'eq', textContent: '+' }), group(b));
      choices(numberOptions(a + b, 10), a + b, () => games.math.round(), { four: true });
    },
  },

  color: {
    title: 'ทายสี',
    list: [
      ['แดง', '#ff3b3b'], ['เขียว', '#2ecc40'], ['น้ำเงิน', '#1e6fff'], ['เหลือง', '#ffd400'],
      ['ส้ม', '#ff8c1a'], ['ม่วง', '#9b4dff'], ['ชมพู', '#ff7ac0'], ['น้ำตาล', '#8b5a2b'],
      ['ดำ', '#222222'], ['ขาว', '#ffffff'],
    ],
    round() {
      const opts = sample(this.list, 4), [name] = pick(opts);
      setPrompt(`แตะสี${name}`, `แตะสี${name}`);
      $('board').replaceChildren(el('span', { className: 'huge', textContent: '🎨' }));
      choices(opts.map(([n, c]) => ({ label: '', value: n, style: c })), name, () => games.color.round(), { four: true });
    },
  },

  shape: {
    title: 'รูปทรง',
    list: [['วงกลม', '🔴'], ['สี่เหลี่ยม', '🟦'], ['สามเหลี่ยม', '🔺'], ['ดาว', '⭐'], ['หัวใจ', '❤️'], ['ข้าวหลามตัด', '🔶']],
    round() {
      const opts = sample(this.list, 4), [name] = pick(opts);
      setPrompt(`รูป${name} อยู่ไหน?`, `รูป${name} อยู่ไหน`);
      $('board').replaceChildren(el('span', { className: 'huge', textContent: '🔍' }));
      choices(opts.map(([n, e]) => ({ label: e, value: n })), name, () => { say(name); games.shape.round(); }, { four: true });
    },
  },

  thai: {
    title: 'ก - ฮ',
    list: [
      ['ก', 'ไก่', '🐔'], ['ข', 'ไข่', '🥚'], ['ค', 'ควาย', '🐃'], ['ฆ', 'ระฆัง', '🔔'], ['ง', 'งู', '🐍'],
      ['จ', 'จาน', '🍽️'], ['ช', 'ช้าง', '🐘'], ['ซ', 'โซ่', '⛓️'], ['ญ', 'หญิง', '👩'], ['ด', 'เด็ก', '🧒'],
      ['ต', 'เต่า', '🐢'], ['ถ', 'ถุง', '🛍️'], ['ท', 'ทหาร', '💂'], ['ธ', 'ธง', '🚩'], ['น', 'หนู', '🐭'],
      ['บ', 'ใบไม้', '🍃'], ['ป', 'ปลา', '🐟'], ['ผ', 'ผึ้ง', '🐝'], ['ฟ', 'ฟัน', '🦷'], ['ภ', 'สำเภา', '⛵'],
      ['ม', 'ม้า', '🐴'], ['ย', 'ยักษ์', '👹'], ['ร', 'เรือ', '🚤'], ['ล', 'ลิง', '🐒'], ['ว', 'แหวน', '💍'],
      ['ษ', 'ฤๅษี', '🧙'], ['ส', 'เสือ', '🐯'], ['ห', 'หีบ', '📦'], ['ฬ', 'จุฬา', '🪁'], ['อ', 'อ่าง', '🛁'],
      ['ฮ', 'นกฮูก', '🦉'],
    ],
    round() {
      const opts = sample(this.list, 4), [ch, word] = pick(opts);
      setPrompt(`${ch} ... อะไรนะ?`, `${ch} อะไรเอ่ย`);
      $('board').replaceChildren(el('span', { className: 'huge', textContent: ch }));
      choices(opts.map(([, w, e]) => ({ label: e, small: w, value: w })), word,
        () => { say(`${ch} ${word}`); setTimeout(() => games.thai.round(), 900); }, { four: true });
    },
  },

  memory: {
    title: 'จับคู่ภาพ',
    pool: ['🐶', '🐱', '🐰', '🐼', '🦁', '🐸', '🐵', '🐧', '🦄', '🐙', '🐞', '🦋'],
    round() {
      setPrompt('หาภาพที่เหมือนกัน', 'หาภาพที่เหมือนกันให้ครบนะ');
      $('choices').replaceChildren();
      const cards = shuffle([...sample(this.pool, 8)].flatMap((e) => [e, e]));
      const grid = el('div', { className: 'memory' });
      let first = null, busy = false, found = 0;
      cards.forEach((e) => {
        const c = el('button', { className: 'mcard', textContent: e, ariaLabel: 'การ์ด' });
        c.onclick = () => {
          if (busy || c === first || c.classList.contains('done')) return;
          c.classList.add('open'); tone(520, 0.08);
          if (!first) { first = c; return; }
          if (first.textContent === e) {
            first.classList.add('done'); c.classList.add('done'); first = null; found++;
            stars++; updateStars(); sfxGood();
            if (found === 8) { sfxWin(); cheer('🏆'); say('เก่งมาก ครบทุกคู่แล้ว'); setTimeout(() => games.memory.round(), 1800); }
          } else {
            busy = true; const f = first; first = null;
            setTimeout(() => { f.classList.remove('open'); c.classList.remove('open'); busy = false; }, 800);
          }
        };
        grid.append(c);
      });
      $('board').replaceChildren(grid);
    },
  },
};

// ---------- navigation ----------
function openGame(name) {
  streak = 0;
  $('menu').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('homeBtn').classList.remove('hidden');
  $('title').textContent = games[name].title;
  games[name].round();
  history.pushState({ game: name }, '', '#' + name);
}
function goHome() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('game').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('homeBtn').classList.add('hidden');
  $('title').textContent = 'เกมหนูน้อย';
}

document.querySelectorAll('.game-card').forEach((b) => (b.onclick = () => openGame(b.dataset.game)));
$('homeBtn').onclick = () => { history.replaceState(null, '', location.pathname); goHome(); };
window.addEventListener('popstate', goHome);
$('soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); updateSoundBtn(); };
updateStars(); updateSoundBtn();
if (location.hash && games[location.hash.slice(1)]) openGame(location.hash.slice(1));

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
