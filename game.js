'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Theme registry. `colors` is index-aligned with PIECES: null at 0, ints 1-7.
const THEMES = {
  retro: {
    name: 'Retro',
    colors: [
      null,
      '#4dd0e1', // I - cyan
      '#ffd54f', // O - yellow
      '#ba68c8', // T - purple
      '#81c784', // S - green
      '#e57373', // Z - red
      '#7986cb', // J - indigo
      '#ffb74d', // L - orange
    ],
    bg: '#1a1a25',
    grid: '#22222e',
    glow: 0,
    radius: 0,
    texture: false,
  },
  neon: {
    name: 'Neon',
    colors: [
      null,
      '#00f0ff', // I
      '#fff200', // O
      '#ff00e6', // T
      '#00ff66', // S
      '#ff0044', // Z
      '#3d5bff', // J
      '#ff8a00', // L
    ],
    bg: '#000000',
    grid: '#1a1a2e',
    glow: 12,
    radius: 0,
    texture: false,
  },
  pastel: {
    name: 'Pastel',
    colors: [
      null,
      '#a7dbe0', // I
      '#f5e6a8', // O
      '#d6bfe6', // T
      '#b8ddb9', // S
      '#f0b8b8', // Z
      '#b9c2e6', // J
      '#f2d3ab', // L
    ],
    bg: '#2a2a35',
    grid: '#33333f',
    glow: 0,
    radius: 6,
    texture: false,
  },
  pixel: {
    name: 'Pixel',
    colors: [
      null,
      '#3f9aa8', // I
      '#c9a227', // O
      '#8e5aa8', // T
      '#5a9e63', // S
      '#b5544f', // Z
      '#55639e', // J
      '#c47f30', // L
    ],
    bg: '#141420',
    grid: '#252533',
    glow: 0,
    radius: 0,
    texture: true,
  },
};

let currentTheme = THEMES.retro;

// 3x3 pixel-art pattern: 1 = lighter, -1 = darker, 0 = base color.
const TEXTURE_PATTERN = [
  [1, 1, 0],
  [1, 0, -1],
  [0, -1, -1],
];

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

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

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
  clearLines();
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

// Shade a #rrggbb color by `amount` in [-1, 1]: positive lightens, negative darkens.
function shadeColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + 255 * amount);
  const g = clamp(((n >> 8) & 255) + 255 * amount);
  const b = clamp((n & 255) + 255 * amount);
  return `rgb(${r},${g},${b})`;
}

function fillBlockShape(context, px, py, w, h, radius) {
  if (radius > 0 && typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(px, py, w, h, radius);
    context.fill();
  } else {
    context.fillRect(px, py, w, h);
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha, theme) {
  if (!colorIndex) return;
  const t = theme || currentTheme;
  const color = t.colors[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const w = size - 2;
  const h = size - 2;

  context.globalAlpha = alpha ?? 1;

  // Base fill (the only fill that gets the glow, so it does not stack).
  if (t.glow > 0) {
    context.shadowColor = color;
    context.shadowBlur = t.glow;
  }
  context.fillStyle = color;
  fillBlockShape(context, px, py, w, h, t.radius);
  // Reset sticky shadow state immediately: it would otherwise bleed into the
  // highlight, the grid lines and every later fill in the frame.
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';

  if (t.texture) {
    // Pixel-art texture: 3x3 lighter/darker cells over the base color.
    const cw = w / 3;
    const chh = h / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const step = TEXTURE_PATTERN[r][c];
        if (!step) continue;
        context.fillStyle = shadeColor(color, step * 0.14);
        context.fillRect(
          Math.floor(px + c * cw),
          Math.floor(py + r * chh),
          Math.ceil(cw),
          Math.ceil(chh)
        );
      }
    }
  } else {
    // Top-edge highlight, clipped to the block silhouette so it does not
    // spill past the rounded corners.
    context.fillStyle = 'rgba(255,255,255,0.12)';
    if (t.radius > 0 && typeof context.roundRect === 'function') {
      context.save();
      context.beginPath();
      context.roundRect(px, py, w, h, t.radius);
      context.clip();
      context.fillRect(px, py, w, 4);
      context.restore();
    } else {
      context.fillRect(px, py, w, 4);
    }
  }

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

// Sets the active theme and forces a repaint. Safe to call before init().
function applyTheme(key) {
  const valid = typeof key === 'string' && Object.prototype.hasOwnProperty.call(THEMES, key);
  currentTheme = valid ? THEMES[key] : THEMES.retro;
  if (board && current) draw();
  if (next) drawNext();
  return currentTheme;
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
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
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
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
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
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

restartBtn.addEventListener('click', init);

init();
