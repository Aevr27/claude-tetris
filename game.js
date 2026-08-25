'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// localStorage keys (shared across features)
const STORAGE_KEY_SKIN = 'tetris.skin'; // 'retro' | 'neon' | 'pastel' | 'pixel'

// Theme palettes. `colors` is index-aligned with PIECES (null at index 0).
const THEMES = {
  retro: {
    name: 'Retro',
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#7986cb', '#ffb74d'],
    bg: '#1a1a25', grid: '#22222e', glow: 0, radius: 0, texture: false,
  },
  neon: {
    name: 'Neon',
    colors: [null, '#00f0ff', '#fff700', '#f000ff', '#00ff5f', '#ff0040', '#3d5afe', '#ff9100'],
    bg: '#000000', grid: '#1a1a2e', glow: 12, radius: 0, texture: false,
  },
  pastel: {
    name: 'Pastel',
    colors: [null, '#a8e6ef', '#ffe9a8', '#e0bbe4', '#b5e7c0', '#ffb3b3', '#b8c0f0', '#ffd6a5'],
    bg: '#2a2a35', grid: '#33333f', glow: 0, radius: 6, texture: false,
  },
  pixel: {
    name: 'Pixel',
    colors: [null, '#2ec4b6', '#ffbf00', '#9b5de5', '#4cb944', '#e63946', '#3a86ff', '#fb8500'],
    bg: '#141420', grid: '#252533', glow: 0, radius: 0, texture: true,
  },
};

const DEFAULT_THEME_KEY = 'retro';
let currentTheme = THEMES[DEFAULT_THEME_KEY];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// ---- Persistence (localStorage) ----
const STORAGE_KEY_SCORES = 'tetris.highscores'; // Array<{name, score, lines, level, date}>, max 5, desc by score
const STORAGE_KEY_STATS = 'tetris.stats';       // {bestCombo, maxLines}

const MAX_SCORES = 5;
const MAX_NAME_LENGTH = 10;
const DEFAULT_NAME = 'JUGADOR';

// In-memory fallbacks used when localStorage is unavailable (private mode, file://)
// or when a write fails (quota exceeded) and stored data is therefore stale.
let memoryScores = null;
let memoryStats = null;
let scoresWriteFailed = false;
let statsWriteFailed = false;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    return false;
  }
}

function sanitizeName(value) {
  const name = String(value == null ? '' : value).trim().slice(0, MAX_NAME_LENGTH);
  return name || DEFAULT_NAME;
}

function toFiniteInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function isValidEntry(entry) {
  return !!entry && typeof entry === 'object' && Number.isFinite(Number(entry.score));
}

function normalizeEntry(entry) {
  return {
    name: sanitizeName(entry.name),
    score: toFiniteInt(entry.score, 0),
    lines: toFiniteInt(entry.lines, 0),
    level: toFiniteInt(entry.level, 1),
    date: typeof entry.date === 'string' ? entry.date : new Date().toISOString(),
  };
}

function loadScores() {
  const raw = readStorage(STORAGE_KEY_SCORES);
  // Prefer the in-memory copy when storage is unavailable or known to be stale.
  if (raw === null || scoresWriteFailed) {
    if (memoryScores) return memoryScores.map(e => ({ ...e }));
    if (raw === null) return [];
  }
  const stale = memoryScores ? memoryScores.map(e => ({ ...e })) : [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return stale;
    return parsed
      .filter(isValidEntry)
      .map(normalizeEntry)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch (err) {
    return stale;
  }
}

// Inserts the entry in descending score order and truncates to the top 5.
// Returns the index of the stored entry, or -1 if it did not make the table.
function saveScore(entry) {
  const item = normalizeEntry(entry || {});
  const list = loadScores();
  let index = list.findIndex(e => item.score > e.score);
  if (index === -1) index = list.length;
  list.splice(index, 0, item);
  const trimmed = list.slice(0, MAX_SCORES);
  if (index >= MAX_SCORES) index = -1;
  memoryScores = trimmed.map(e => ({ ...e }));
  if (!writeStorage(STORAGE_KEY_SCORES, JSON.stringify(trimmed))) scoresWriteFailed = true;
  return index;
}

function qualifiesForTop(value) {
  if (!(value > 0)) return false;
  const list = loadScores();
  return list.length < MAX_SCORES || value > list[list.length - 1].score;
}

function loadStats() {
  const fallback = memoryStats ? { ...memoryStats } : { bestCombo: 0, maxLines: 0 };
  const raw = readStorage(STORAGE_KEY_STATS);
  if (raw === null || statsWriteFailed) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return {
      bestCombo: Math.max(0, toFiniteInt(parsed.bestCombo, 0)),
      maxLines: Math.max(0, toFiniteInt(parsed.maxLines, 0)),
    };
  } catch (err) {
    return fallback;
  }
}

function updateStats(run) {
  const stats = loadStats();
  const runCombo = Math.max(0, toFiniteInt(run && run.combo, 0));
  const runLines = Math.max(0, toFiniteInt(run && run.lines, 0));
  const updated = {
    bestCombo: Math.max(stats.bestCombo, runCombo),
    maxLines: Math.max(stats.maxLines, runLines),
  };
  memoryStats = { ...updated };
  if (!writeStorage(STORAGE_KEY_STATS, JSON.stringify(updated))) statsWriteFailed = true;
  return updated;
}

function resetRecords() {
  memoryScores = [];
  memoryStats = { bestCombo: 0, maxLines: 0 };
  scoresWriteFailed = false;
  statsWriteFailed = false;
  removeStorage(STORAGE_KEY_SCORES);
  removeStorage(STORAGE_KEY_STATS);
}

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const skinSelector = document.getElementById('skin-selector');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const scoresPanel = document.getElementById('scores-panel');
const scoresTable = document.getElementById('scores-table');
const statsLine = document.getElementById('stats-line');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, bestCombo, scoreCommitted;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  const cleared = clearLines();
  if (cleared > 0) {
    combo++;
    if (combo > bestCombo) bestCombo = combo;
  } else {
    combo = 0;
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

/* ---- Themes: persistence, application and selector ---- */

function loadSkin() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SKIN);
    if (stored && Object.prototype.hasOwnProperty.call(THEMES, stored)) return stored;
  } catch (err) {
    // localStorage unavailable (private mode / file://) - fall back to default
  }
  return DEFAULT_THEME_KEY;
}

function saveSkin(key) {
  try {
    localStorage.setItem(STORAGE_KEY_SKIN, key);
  } catch (err) {
    // Ignore: degrade silently to in-memory only
  }
}

function applyTheme(key) {
  const themeKey = Object.prototype.hasOwnProperty.call(THEMES, key) ? key : DEFAULT_THEME_KEY;
  currentTheme = THEMES[themeKey];
  document.body.dataset.theme = themeKey;
  updateSkinSelector(themeKey);
  // Force an immediate repaint so the change is visible even while paused.
  if (next) drawNext();
  if (current) draw();
  return themeKey;
}

function updateSkinSelector(themeKey) {
  if (!skinSelector) return;
  for (const btn of skinSelector.querySelectorAll('.skin-btn')) {
    const isActive = btn.dataset.skin === themeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

function setSkin(key) {
  const themeKey = applyTheme(key);
  saveSkin(themeKey);
}

function initSkinSelector() {
  if (!skinSelector) return;
  skinSelector.addEventListener('click', e => {
    const btn = e.target.closest('.skin-btn');
    if (!btn || !skinSelector.contains(btn)) return;
    setSkin(btn.dataset.skin);
    // Release focus so Space/arrows reach the game, not the button.
    btn.blur();
  });
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = currentTheme.colors[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = currentTheme.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = currentTheme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextCtx.fillStyle = currentTheme.bg;
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// Paints the top-5 table into containerEl. highlightIndex marks one row (-1 for none).
// Built with textContent only: names come from localStorage and must never be HTML.
function renderScoreTable(containerEl, highlightIndex) {
  if (!containerEl) return;
  containerEl.textContent = '';
  const entries = loadScores();

  const table = document.createElement('table');
  table.className = 'score-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['#', 'Nombre', 'Puntuación', 'Líneas', 'Nivel'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (entries.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'score-empty';
    cell.textContent = 'Sin récords todavía';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    entries.forEach((entry, i) => {
      const row = document.createElement('tr');
      if (i === highlightIndex) row.classList.add('highlight');
      [
        String(i + 1),
        entry.name,
        entry.score.toLocaleString(),
        String(entry.lines),
        String(entry.level),
      ].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
  }
  table.appendChild(tbody);
  containerEl.appendChild(table);
}

function renderStatsLine() {
  const stats = loadStats();
  statsLine.textContent = `Mejor combo: ${stats.bestCombo} · Líneas máximas: ${stats.maxLines}`;
}

function commitScore() {
  if (scoreCommitted) return;
  scoreCommitted = true;
  const index = saveScore({
    name: sanitizeName(nameInput.value),
    score,
    lines,
    level,
    date: new Date().toISOString(),
  });
  nameEntry.classList.add('hidden');
  renderScoreTable(scoresTable, index);
}

function endGame() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  updateStats({ combo: bestCombo, lines });

  const qualifies = qualifiesForTop(score);
  renderScoreTable(scoresTable, -1);
  renderStatsLine();
  scoresPanel.classList.remove('hidden');

  if (qualifies) {
    nameInput.value = DEFAULT_NAME;
    nameEntry.classList.remove('hidden');
  } else {
    nameEntry.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
  if (qualifies) {
    nameInput.focus();
    nameInput.select();
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nameEntry.classList.add('hidden');
    scoresPanel.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  bestCombo = 0;
  scoreCommitted = false;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  nameEntry.classList.add('hidden');
  scoresPanel.classList.add('hidden');
  overlay.classList.add('hidden');
  // Keep focus off the button: a focused <button> also fires on Space (hard drop).
  restartBtn.blur();
  saveScoreBtn.blur();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

document.addEventListener('keydown', e => {
  // Let the skin buttons handle their own keyboard activation (Space / Enter).
  if (e.target instanceof Element && e.target.closest('#skin-selector')) return;
  // While the name field is focused, typing is text entry, not game input.
  if (isTypingTarget(e.target)) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

saveScoreBtn.addEventListener('click', commitScore);

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitScore();
  }
});

restartBtn.addEventListener('click', init);

initSkinSelector();
applyTheme(loadSkin());
init();
