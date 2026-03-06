'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */
const SQRT3    = Math.sqrt(3);
const HEX_BASE = 36;

const AXES = [
  { d: [[ 1, 0], [-1,  0]] },
  { d: [[ 0, 1], [ 0, -1]] },
  { d: [[ 1,-1], [-1,  1]] },
];
const NEIGHBORS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

// Only unambiguous chars for room codes
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ============================================================
   DISPLAY PREFERENCES
   ============================================================ */
const PREFS = { showThreats: true, showMomentum: true, showLastMove: true };

/* ============================================================
   SESSION SCORES
   ============================================================ */
const SESSION = { xWins: 0, oWins: 0 };

/* ============================================================
   GAME STATE
   mode: '2p' | 'medium' | 'hard' | 'online'
   onlineColor: 'X' | 'O'  (which color the local player controls)
   ============================================================ */
let G = freshGame('2p', 'X');

function freshGame(mode, onlineColor) {
  return {
    cells:       {},
    player:      'X',
    movesLeft:   1,
    firstDone:   false,
    over:        false,
    winLine:     [],
    threats:     new Set(),
    xThreats:    0,
    oThreats:    0,
    lastMove:    null,
    mode:        mode  || '2p',
    onlineColor: onlineColor || 'X',
    totalMoves:  0,
  };
}

/* ============================================================
   UNDO HISTORY
   ============================================================ */
let history = [];

function pushSnapshot() {
  history.push({
    cells:      { ...G.cells },
    player:     G.player,
    movesLeft:  G.movesLeft,
    firstDone:  G.firstDone,
    over:       G.over,
    winLine:    [...G.winLine],
    threats:    new Set(G.threats),
    xThreats:   G.xThreats,
    oThreats:   G.oThreats,
    lastMove:   G.lastMove ? { ...G.lastMove } : null,
    totalMoves: G.totalMoves,
  });
  refreshUndoBtn();
}

function popSnapshot() {
  if (!history.length) return false;
  const s = history.pop();
  Object.assign(G, {
    cells: s.cells, player: s.player, movesLeft: s.movesLeft,
    firstDone: s.firstDone, over: s.over, winLine: s.winLine,
    threats: s.threats, xThreats: s.xThreats, oThreats: s.oThreats,
    lastMove: s.lastMove, totalMoves: s.totalMoves,
  });
  return true;
}

function doUndo() {
  if (!history.length || G.over) return;
  if (G.mode === 'online') return; // no undo online

  V.botToken++;
  setBotBadge(false);
  popSnapshot();

  // In bot modes, keep popping until it's the human's turn
  const isBotMode = G.mode === 'medium' || G.mode === 'hard';
  if (isBotMode) {
    while (G.player === 'O' && history.length) popSnapshot();
  }

  V.anims = {};
  refreshUndoBtn();
  updateUI();
  scheduleRender();
}

/* ============================================================
   NETWORK STATE (PeerJS)
   ============================================================ */
const NET = {
  peer:   null,
  conn:   null,
  role:   null,   // 'host' | 'guest'
  code:   null,
  status: 'idle', // 'idle' | 'creating' | 'waiting' | 'joining' | 'connected' | 'error'
};

function generateCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

function peerId(code) { return `sixinarow-${code}`; }

function netSend(obj) {
  if (NET.conn && NET.conn.open) NET.conn.send(obj);
}

function netTeardown() {
  if (NET.peer) {
    try { NET.peer.destroy(); } catch (_) {}
    NET.peer = null;
  }
  NET.conn   = null;
  NET.role   = null;
  NET.code   = null;
  NET.status = 'idle';
}

function setupConnHandlers(conn) {
  conn.on('data', data => {
    if (data.type === 'move') {
      if (!G.over) placeMove(data.q, data.r, true);
    } else if (data.type === 'newgame') {
      doNewGameOnline(false);
    }
  });
  conn.on('close', () => {
    NET.status = 'idle';
    showDisconnectAlert();
  });
  conn.on('error', err => {
    console.warn('conn error', err);
  });
}

function showDisconnectAlert() {
  const badge = document.getElementById('onlineTurnBadge');
  if (badge) {
    badge.querySelector('span:last-child').textContent = 'Opponent disconnected';
    badge.classList.add('show');
    badge.classList.remove('hidden');
  }
}

/* ============================================================
   CAMERA / VIEW STATE
   ============================================================ */
let V = {
  panX: 0, panY: 0, zoom: 1,
  hovQ: null, hovR: null,
  drag: false, isDrag: false,
  dsx: 0, dsy: 0, dpx: 0, dpy: 0,
  anims:    {},
  botToken: 0,
};

/* ============================================================
   DOM REFERENCES  (populated in DOMContentLoaded)
   ============================================================ */
let canvas, ctx, wrap, dpr;

/* ============================================================
   CANVAS SETUP
   ============================================================ */
function resize() {
  if (!canvas || !wrap) return;
  const r   = wrap.getBoundingClientRect();
  dpr       = window.devicePixelRatio || 1;
  canvas.width        = r.width  * dpr;
  canvas.height       = r.height * dpr;
  canvas.style.width  = r.width  + 'px';
  canvas.style.height = r.height + 'px';
  scheduleRender();
}

/* ============================================================
   HEX MATH
   ============================================================ */
function hexSize() { return HEX_BASE * V.zoom * dpr; }

function h2p(q, r) {
  const s = hexSize();
  return {
    x: s * (SQRT3 * q + SQRT3 * 0.5 * r) + canvas.width  * 0.5 + V.panX * dpr,
    y: s * (1.5 * r)                      + canvas.height * 0.5 + V.panY * dpr,
  };
}
function p2h(cx, cy) {
  const s  = hexSize();
  const wx = (cx - canvas.width  * 0.5 - V.panX * dpr) / s;
  const wy = (cy - canvas.height * 0.5 - V.panY * dpr) / s;
  return hexRound(SQRT3 / 3 * wx - 1 / 3 * wy, 2 / 3 * wy);
}
function hexRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
  const dq = Math.abs(q-fq), dr = Math.abs(r-fr), ds = Math.abs(s-fs);
  if      (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds)            r = -q - s;
  return { q, r };
}
function k(q, r) { return `${q},${r}`; }

function hexPath(cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    const x = cx + size * Math.cos(a);
    const y = cy + size * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ============================================================
   GAME LOGIC
   ============================================================ */
function countDir(q, r, dq, dr, player) {
  let n = 0, nq = q+dq, nr = r+dr;
  while (G.cells[k(nq,nr)] === player) { n++; nq+=dq; nr+=dr; }
  return n;
}
function chainThrough(q, r, axis, player) {
  const [[d1q,d1r],[d2q,d2r]] = axis.d;
  const cells = [[q,r]];
  let nq=q+d1q, nr=r+d1r;
  while (G.cells[k(nq,nr)] === player) { cells.push([nq,nr]); nq+=d1q; nr+=d1r; }
  nq=q+d2q; nr=r+d2r;
  while (G.cells[k(nq,nr)] === player) { cells.unshift([nq,nr]); nq+=d2q; nr+=d2r; }
  return cells;
}
function checkWin(q, r, player) {
  for (const axis of AXES) {
    const chain = chainThrough(q, r, axis, player);
    if (chain.length >= 6) return chain;
  }
  return null;
}
function updateThreats() {
  const threats = new Set();
  let xt = 0, ot = 0;
  const seen = new Set();
  for (const key of Object.keys(G.cells)) {
    const [q,r] = key.split(',').map(Number);
    const player = G.cells[key];
    for (const axis of AXES) {
      const chain = chainThrough(q, r, axis, player);
      if (chain.length < 4 || chain.length >= 6) continue;
      const ck = chain.map(([a,b])=>k(a,b)).sort().join('|');
      if (seen.has(ck)) continue;
      seen.add(ck);
      chain.forEach(([cq,cr]) => threats.add(k(cq,cr)));
      if (player === 'X') xt++; else ot++;
    }
  }
  G.threats = threats; G.xThreats = xt; G.oThreats = ot;
}

// fromNetwork flag: if true, don't echo back to opponent
function placeMove(q, r, fromNetwork = false) {
  if (G.over || G.cells[k(q,r)]) return false;

  G.cells[k(q,r)] = G.player;
  G.lastMove       = { q, r };
  G.totalMoves++;
  V.anims[k(q,r)] = { t: 0 };

  const win = checkWin(q, r, G.player);
  if (win) {
    G.winLine = win;
    G.over    = true;
    if (G.player === 'X') SESSION.xWins++;
    else                  SESSION.oWins++;
    updateThreats();
    updateUI();
    scheduleRender();
    setTimeout(showWinModal, 700);

    if (G.mode === 'online' && !fromNetwork) netSend({ type: 'move', q, r });
    return true;
  }

  updateThreats();

  G.movesLeft--;
  if (G.movesLeft <= 0) {
    G.player    = G.player === 'X' ? 'O' : 'X';
    G.movesLeft = 2;
    G.firstDone = true;
  }

  if (G.mode === 'online' && !fromNetwork) netSend({ type: 'move', q, r });

  updateUI();
  scheduleRender();
  return true;
}

/* ============================================================
   NEW GAME
   ============================================================ */
function startNewGame() {
  if (G.mode === 'online') { doNewGameOnline(true); return; }
  V.botToken++;
  setBotBadge(false);
  const mode = G.mode;
  G        = freshGame(mode, 'X');
  history  = [];
  V.anims  = {};
  V.hovQ   = null; V.hovR = null;
  hideModal();
  refreshUndoBtn();
  updateUI();
  scheduleRender();
}

function doNewGameOnline(broadcast) {
  V.botToken++;
  const color = G.onlineColor;
  G       = freshGame('online', color);
  history = [];
  V.anims = {};
  hideModal();
  updateOnlineTurnBadge();
  updateUI();
  scheduleRender();
  if (broadcast) netSend({ type: 'newgame' });
}

/* ============================================================
   CENTRE VIEW
   ============================================================ */
function centerView() {
  const keys = Object.keys(G.cells);
  if (!keys.length) { V.panX = 0; V.panY = 0; V.zoom = 1; scheduleRender(); return; }
  let sq = 0, sr = 0;
  for (const key of keys) { const [q,r] = key.split(',').map(Number); sq+=q; sr+=r; }
  const cq = sq / keys.length, cr = sr / keys.length;
  const s  = HEX_BASE * V.zoom;
  V.panX = -(s * (SQRT3 * cq + SQRT3 * 0.5 * cr));
  V.panY = -(s * (1.5 * cr));
  scheduleRender();
}

/* ============================================================
   BOT AI
   ============================================================ */
function getCandidates() {
  const placed = Object.keys(G.cells);
  if (placed.length === 0) return [[0,0]];
  const cands = new Set();
  for (const key of placed) {
    const [q,r] = key.split(',').map(Number);
    for (const [dq,dr] of NEIGHBORS) {
      const nk = k(q+dq, r+dr);
      if (!G.cells[nk]) cands.add(nk);
      for (const [dq2,dr2] of NEIGHBORS) {
        const nk2 = k(q+dq+dq2, r+dr+dr2);
        if (!G.cells[nk2]) cands.add(nk2);
      }
    }
  }
  return [...cands].map(s => s.split(',').map(Number));
}

function axisLen(q, r, axis, player) {
  const [[d1q,d1r],[d2q,d2r]] = axis.d;
  return 1 + countDir(q,r,d1q,d1r,player) + countDir(q,r,d2q,d2r,player);
}
function openEnds(q, r, axis, player) {
  const [[d1q,d1r],[d2q,d2r]] = axis.d;
  let open = 0;
  let nq=q+d1q, nr=r+d1r;
  while (G.cells[k(nq,nr)] === player) { nq+=d1q; nr+=d1r; }
  if (!G.cells[k(nq,nr)]) open++;
  nq=q+d2q; nr=r+d2r;
  while (G.cells[k(nq,nr)] === player) { nq+=d2q; nr+=d2r; }
  if (!G.cells[k(nq,nr)]) open++;
  return open;
}

function scoreMove(q, r, player) {
  const opp = player === 'X' ? 'O' : 'X';
  let score  = 0;

  G.cells[k(q,r)] = player;
  for (const axis of AXES) {
    const n = axisLen(q,r,axis,player), e = openEnds(q,r,axis,player);
    const m = e===2 ? 2.5 : e===1 ? 1.2 : 0.3;
    if      (n>=6) score += 2000000;
    else if (n===5) score += 100000*m;
    else if (n===4) score +=   8000*m;
    else if (n===3) score +=    600*m;
    else if (n===2) score +=     50*m;
    else            score +=      4;
  }
  delete G.cells[k(q,r)];

  G.cells[k(q,r)] = opp;
  for (const axis of AXES) {
    const n = axisLen(q,r,axis,opp), e = openEnds(q,r,axis,opp);
    const m = e===2 ? 2.2 : e===1 ? 1.0 : 0.3;
    if      (n>=6) score += 1900000;
    else if (n===5) score +=  90000*m;
    else if (n===4) score +=   7000*m;
    else if (n===3) score +=    500*m;
    else if (n===2) score +=     40*m;
  }
  delete G.cells[k(q,r)];

  score -= (Math.abs(q)+Math.abs(r)) * 1.5;
  return score;
}

/* 1-ply greedy — Medium difficulty */
function getBotMoveSingle(cands) {
  cands = cands || getCandidates();
  if (!cands.length) return null;
  let best = null, bestS = -Infinity;
  for (const [q,r] of cands) {
    const s = scoreMove(q,r,G.player) + Math.random()*15;
    if (s > bestS) { bestS = s; best = [q,r]; }
  }
  return best;
}

/* 2-move pair optimisation — Hard difficulty
   Evaluates all first-move candidates (up to 60), then for each, finds the
   best second move with the first already placed. Picks the pair with highest
   combined score. This lets the bot set up double threats in a single turn. */
function getBotMovePairHard() {
  const allCands = getCandidates();
  if (!allCands.length) return [null, null];

  // Pre-score first moves on clean board, take top 60
  const scored = allCands
    .map(([q,r]) => [q, r, scoreMove(q,r,G.player)])
    .sort((a,b) => b[2]-a[2])
    .slice(0, 60);

  // Instant win check: take it immediately
  if (scored[0][2] >= 1000000) {
    const [q1,r1] = scored[0];
    G.cells[k(q1,r1)] = G.player;
    const win = checkWin(q1,r1,G.player);
    delete G.cells[k(q1,r1)];
    if (win) return [[q1,r1], null];
  }

  let bestScore = -Infinity;
  let bestPair  = [null, null];

  for (const [q1,r1,s1] of scored) {
    // Place first move temporarily
    G.cells[k(q1,r1)] = G.player;

    // Check instant win from first move
    const win1 = checkWin(q1,r1,G.player);
    if (win1) {
      delete G.cells[k(q1,r1)];
      return [[q1,r1], null];
    }

    // Find best second move with first placed
    const cands2 = getCandidates().filter(([q,r]) => !(q===q1 && r===r1));
    let bestS2 = -Infinity, bestMv2 = null;
    // Limit to top 50 for performance
    for (const [q2,r2] of cands2.slice(0, 50)) {
      const s2 = scoreMove(q2,r2,G.player) + Math.random()*8;
      if (s2 > bestS2) { bestS2 = s2; bestMv2 = [q2,r2]; }
    }

    delete G.cells[k(q1,r1)];

    const combined = s1 + bestS2 * 0.82;
    if (combined > bestScore) {
      bestScore = combined;
      bestPair  = [[q1,r1], bestMv2];
    }
  }

  return bestPair;
}

async function runBotTurn() {
  const token     = V.botToken;
  const movesNow  = G.movesLeft;

  setBotBadge(true);

  if (G.mode === 'medium') {
    // 1-ply: pick moves greedily one at a time
    for (let i = 0; i < movesNow; i++) {
      if (token !== V.botToken || G.over || G.player !== 'O') break;
      await sleep(320 + Math.random()*200);
      if (token !== V.botToken || G.over || G.player !== 'O') break;
      const mv = getBotMoveSingle();
      if (mv) placeMove(mv[0], mv[1]);
    }
  } else {
    // Hard: compute the full pair FIRST, then execute with delays
    const pair = (movesNow >= 2) ? getBotMovePairHard() : [getBotMoveSingle(), null];

    for (let i = 0; i < pair.length; i++) {
      if (token !== V.botToken || G.over || G.player !== 'O') break;
      const mv = pair[i];
      if (!mv) break;
      await sleep(520 + Math.random()*320);
      if (token !== V.botToken || G.over || G.player !== 'O') break;
      placeMove(mv[0], mv[1]);
    }
  }

  if (token === V.botToken) setBotBadge(false);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setBotBadge(v) {
  document.getElementById('thinkBadge')?.classList.toggle('show', v);
}

/* ============================================================
   RENDERING
   ============================================================ */
let rafPending = false;

function scheduleRender() {
  if (!canvas) return;
  if (!rafPending) { rafPending = true; requestAnimationFrame(drawFrame); }
}

function drawFrame(now) {
  rafPending = false;
  if (!canvas) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const s    = hexSize();
  const cH   = p2h(W * 0.5, H * 0.5);
  const cols  = Math.ceil(W / (s * SQRT3)) + 5;
  const rows  = Math.ceil(H / (s * 1.5))   + 5;
  const minQ  = cH.q - cols, maxQ = cH.q + cols;
  const minR  = cH.r - rows, maxR = cH.r + rows;

  let needsContinuous = false;

  for (let r = minR; r <= maxR; r++)
    for (let q = minQ; q <= maxQ; q++)
      if (drawHex(q, r, s, now)) needsContinuous = true;

  for (const key of Object.keys(G.cells)) {
    const [q,r] = key.split(',').map(Number);
    if (q<minQ||q>maxQ||r<minR||r>maxR)
      if (drawHex(q,r,s,now)) needsContinuous = true;
  }

  let anyAnim = false;
  for (const key of Object.keys(V.anims)) {
    V.anims[key].t = Math.min(1, V.anims[key].t + 0.07);
    if (V.anims[key].t < 1) anyAnim = true;
    else delete V.anims[key];
  }

  if (anyAnim || needsContinuous) scheduleRender();
}

function drawHex(q, r, s, now) {
  const {x,y} = h2p(q,r);
  const pad    = s * 2;
  if (x<-pad||x>canvas.width+pad||y<-pad||y>canvas.height+pad) return false;

  const key    = k(q,r);
  const piece  = G.cells[key];
  const isBotMode = G.mode === 'medium' || G.mode === 'hard';
  const isHuman = G.mode === '2p' || G.player === 'X';
  const isOnlineMyTurn = G.mode === 'online' && G.player === G.onlineColor;
  const canHover = (G.mode === '2p' || (isBotMode && G.player === 'X') || isOnlineMyTurn) && !G.over;

  const isHov  = canHover && V.hovQ === q && V.hovR === r && !piece;
  const isWin  = G.over && G.winLine.some(([wq,wr]) => wq===q && wr===r);
  const isThr  = PREFS.showThreats && G.threats.has(key);
  const isLast = PREFS.showLastMove && G.lastMove && G.lastMove.q===q && G.lastMove.r===r;
  const anim   = V.anims[key];
  const inner  = s * 0.93;

  hexPath(x, y, inner);
  if (isWin) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    ctx.fillStyle = `rgba(74,138,46,${0.1 + pulse * 0.22})`;
  } else if (isThr && !piece) {
    ctx.fillStyle = 'rgba(192,134,10,0.055)';
  } else if (isHov) {
    ctx.fillStyle = G.player === 'X'
      ? 'rgba(124,74,45,0.085)' : 'rgba(45,90,124,0.085)';
  } else {
    ctx.fillStyle = 'rgba(255,252,248,0.82)';
  }
  ctx.fill();

  ctx.strokeStyle = isWin
    ? 'rgba(74,138,46,0.48)'
    : isThr ? 'rgba(192,134,10,0.26)' : 'rgba(175,150,120,0.27)';
  ctx.lineWidth = (isWin||isThr) ? 1.5*dpr : 0.7*dpr;
  ctx.stroke();

  if (piece) {
    const scale = anim ? easeOutBounce(anim.t) : 1;
    drawPiece(x, y, s, piece, scale, isWin);

    if (isLast && !isWin) {
      ctx.beginPath();
      ctx.arc(x, y, s*0.5, 0, Math.PI*2);
      ctx.strokeStyle = piece==='X'
        ? 'rgba(124,74,45,0.38)' : 'rgba(45,90,124,0.38)';
      ctx.lineWidth = 1.8*dpr;
      ctx.setLineDash([4*dpr, 3*dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (isHov) drawPiece(x, y, s, G.player, 1, false, true);
  return isWin;
}

function easeOutBounce(t) {
  const n1=7.5625, d1=2.75;
  if      (t < 1/d1)    return n1*t*t;
  else if (t < 2/d1)    return n1*(t-=1.5/d1)*t + 0.75;
  else if (t < 2.5/d1)  return n1*(t-=2.25/d1)*t + 0.9375;
  else                  return n1*(t-=2.625/d1)*t + 0.984375;
}

function drawPiece(x, y, s, player, scale=1, isWin=false, ghost=false) {
  const r   = s * 0.43 * scale;
  const isX = player === 'X';
  const col = isX ? '#7C4A2D' : '#2D5A7C';
  const hi  = isX ? '#C0825A' : '#5A98C8';

  ctx.save();
  ctx.translate(x, y);
  if (ghost) ctx.globalAlpha = 0.27;

  if (!ghost && scale > 0.5) {
    ctx.shadowColor   = isX ? 'rgba(124,74,45,0.25)' : 'rgba(45,90,124,0.25)';
    ctx.shadowBlur    = s * 0.25;
    ctx.shadowOffsetY = s * 0.07;
  }

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  const grd = ctx.createRadialGradient(-r*0.28, -r*0.3, 0, 0, 0, r);
  grd.addColorStop(0, hi);
  grd.addColorStop(1, col);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.beginPath();
  ctx.arc(-r*0.22, -r*0.26, r*0.32, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.17)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.strokeStyle = isX ? 'rgba(80,36,16,0.3)' : 'rgba(20,55,90,0.3)';
  ctx.lineWidth   = dpr * 0.7;
  ctx.stroke();

  if (scale > 0.55 && !ghost) {
    ctx.fillStyle    = 'rgba(255,255,255,0.92)';
    ctx.font         = `600 ${r*0.95}px 'Cormorant Garamond', serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player, 0, r*0.07);
  }
  ctx.restore();
}

/* ============================================================
   INPUT: MOUSE
   ============================================================ */
function cpx(e) {
  const b = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - b.left) * (canvas.width  / b.width),
    y: (e.clientY - b.top)  * (canvas.height / b.height),
  };
}

function bindCanvasEvents() {
  canvas.addEventListener('mousedown', e => {
    const p = cpx(e);
    V.drag=true; V.isDrag=false;
    V.dsx=p.x; V.dsy=p.y; V.dpx=V.panX; V.dpy=V.panY;
  });

  canvas.addEventListener('mousemove', e => {
    const p = cpx(e);
    if (V.drag) {
      const dx=p.x-V.dsx, dy=p.y-V.dsy;
      if (Math.abs(dx)>3||Math.abs(dy)>3) V.isDrag=true;
      if (V.isDrag) {
        V.panX=V.dpx+dx/dpr; V.panY=V.dpy+dy/dpr;
        wrap.style.cursor='grabbing';
        scheduleRender(); return;
      }
    }
    const h=p2h(p.x,p.y);
    if (h.q!==V.hovQ||h.r!==V.hovR) { V.hovQ=h.q; V.hovR=h.r; scheduleRender(); }
  });

  canvas.addEventListener('mouseup', e => {
    const wasDrag=V.isDrag;
    V.drag=false; V.isDrag=false; wrap.style.cursor='crosshair';
    if (!wasDrag&&!G.over) { const p=cpx(e); const h=p2h(p.x,p.y); handleClick(h.q,h.r); }
  });

  canvas.addEventListener('mouseleave', () => {
    V.drag=false; V.hovQ=null; V.hovR=null; scheduleRender();
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor  = e.deltaY<0 ? 1.1 : 0.909;
    const newZoom = Math.max(0.35, Math.min(3.5, V.zoom*factor));
    const p       = cpx(e);
    const wx      = (p.x - canvas.width *0.5)/dpr;
    const wy      = (p.y - canvas.height*0.5)/dpr;
    const sc      = newZoom/V.zoom;
    V.panX=wx+(V.panX-wx)*sc; V.panY=wy+(V.panY-wy)*sc; V.zoom=newZoom;
    scheduleRender();
  }, { passive: false });

  /* Touch */
  let lastPinch = 0;
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length===1) {
      const t=e.touches[0], b=canvas.getBoundingClientRect();
      V.drag=true; V.isDrag=false;
      V.dsx=(t.clientX-b.left)*(canvas.width/b.width);
      V.dsy=(t.clientY-b.top)*(canvas.height/b.height);
      V.dpx=V.panX; V.dpy=V.panY;
    } else if (e.touches.length===2) {
      lastPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    }
  }, { passive:false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length===1&&V.drag) {
      const t=e.touches[0], b=canvas.getBoundingClientRect();
      const px=(t.clientX-b.left)*(canvas.width/b.width);
      const py=(t.clientY-b.top)*(canvas.height/b.height);
      const dx=px-V.dsx, dy=py-V.dsy;
      if (Math.abs(dx)>5||Math.abs(dy)>5) V.isDrag=true;
      if (V.isDrag) { V.panX=V.dpx+dx/dpr; V.panY=V.dpy+dy/dpr; scheduleRender(); }
    } else if (e.touches.length===2&&lastPinch) {
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      V.zoom=Math.max(0.35,Math.min(3.5,V.zoom*d/lastPinch)); lastPinch=d; scheduleRender();
    }
  }, { passive:false });

  canvas.addEventListener('touchend', e => {
    if (!V.isDrag&&e.changedTouches.length===1&&!G.over) {
      const t=e.changedTouches[0], b=canvas.getBoundingClientRect();
      const cx=(t.clientX-b.left)*(canvas.width/b.width);
      const cy=(t.clientY-b.top)*(canvas.height/b.height);
      const h=p2h(cx,cy); handleClick(h.q,h.r);
    }
    V.drag=false; V.isDrag=false; lastPinch=0;
  }, { passive:false });
}

/* ============================================================
   CLICK HANDLER
   ============================================================ */
async function handleClick(q, r) {
  if (G.over || G.cells[k(q,r)]) return;

  const isBotMode = G.mode === 'medium' || G.mode === 'hard';

  if (isBotMode && G.player === 'O') return; // bot's turn
  if (G.mode === 'online' && G.player !== G.onlineColor) return; // not your turn online

  pushSnapshot();
  placeMove(q, r);

  if (!G.over && isBotMode && G.player === 'O') {
    await runBotTurn();
  }

  if (G.mode === 'online') updateOnlineTurnBadge();
}

window.addEventListener('keydown', e => {
  if (document.getElementById('viewGame')?.classList.contains('active')) {
    if (e.key==='n'||e.key==='N') startNewGame();
    if (e.key==='r'||e.key==='R') centerView();
    if (e.key==='z'||e.key==='Z'||e.key==='u'||e.key==='U') doUndo();
  }
});

/* ============================================================
   NAVIGATION
   ============================================================ */
function showHome() {
  document.getElementById('viewHome').classList.add('active');
  document.getElementById('viewGame').classList.remove('active');
}

function showGame(mode) {
  if (mode) G.mode = mode;
  document.getElementById('viewHome').classList.remove('active');
  document.getElementById('viewGame').classList.add('active');
  // Resize canvas now that view is visible
  setTimeout(() => { resize(); scheduleRender(); }, 20);
}

/* ============================================================
   UI UPDATES
   ============================================================ */
function updateUI() {
  const cX   = document.getElementById('cardX');
  const cO   = document.getElementById('cardO');
  const subX = document.getElementById('subX');
  const subO = document.getElementById('subO');
  const dX   = document.getElementById('dotsX');
  const dO   = document.getElementById('dotsO');
  const stEl = document.getElementById('statusText');
  const mcEl = document.getElementById('moveCount');
  if (!cX) return;

  // O player name
  const oLabel = G.mode === '2p' ? 'Player O'
    : G.mode === 'medium' || G.mode === 'hard' ? 'Bot'
    : G.onlineColor === 'O' ? 'You (O)' : 'Opponent';
  document.getElementById('oName').textContent = oLabel;

  // Mode badge
  const badges = { '2p':'Local Play', 'medium':'vs Bot · Medium', 'hard':'vs Bot · Hard',
    'online': NET.role === 'host' ? `Online · You are X` : `Online · You are O` };
  document.getElementById('modeBadge').textContent = badges[G.mode] || 'Local Play';

  const xAct = G.player==='X' && !G.over;
  const oAct = G.player==='O' && !G.over;
  cX.className = 'pcard px' + (xAct?' act-x':'');
  cO.className = 'pcard po' + (oAct?' act-o':'');

  if (G.over) {
    const w = G.winLine.length ? G.cells[k(G.winLine[0][0],G.winLine[0][1])] : null;
    subX.textContent = w==='X' ? 'Winner!' : 'Game over';
    subO.textContent = w==='O' ? 'Winner!' : 'Game over';
    if (w==='X') cX.className += ' act-x';
    if (w==='O') cO.className += ' act-o';
    stEl.textContent = w ? `${w} wins!` : 'Game over';
  } else if (xAct) {
    subX.textContent = `Your turn · ${G.movesLeft} move${G.movesLeft>1?'s':''}`;
    subO.textContent = (G.mode==='2p') ? 'Waiting…' : '';
    stEl.textContent = 'X is playing';
  } else {
    subX.textContent = 'Waiting…';
    const isBotMode = G.mode==='medium'||G.mode==='hard';
    subO.textContent = G.mode==='2p'
      ? `Your turn · ${G.movesLeft} moves`
      : isBotMode ? 'Thinking…'
      : `Opponent's turn`;
    stEl.textContent = G.mode==='2p' ? 'O is playing' : isBotMode ? 'Bot thinking' : "Opponent's turn";
  }

  const xTotal = !G.firstDone ? 1 : 2;
  const xFill  = xAct ? G.movesLeft : 0;
  const oFill  = oAct ? G.movesLeft : 0;
  dX.innerHTML = Array.from({length:xTotal},(_,i) => `<div class="dot${i<xFill?' x':''}"></div>`).join('');
  dO.innerHTML = Array.from({length:2},(_,i)      => `<div class="dot${i<oFill?' o':''}"></div>`).join('');

  mcEl.textContent = G.totalMoves;
  document.getElementById('scoreX').textContent = SESSION.xWins;
  document.getElementById('scoreO').textContent = SESSION.oWins;

  updateMomentum();
  refreshUndoBtn();
}

function updateMomentum() {
  const total = G.xThreats + G.oThreats;
  const bar   = document.getElementById('momentumBar');
  const label = document.getElementById('momentumText');
  if (!bar) return;
  if (total===0) {
    bar.style.width='50%'; label.textContent='—'; label.style.color='var(--muted)'; return;
  }
  const x = G.xThreats/total;
  bar.style.width = (x*100).toFixed(1)+'%';
  if      (x>0.6) { label.textContent='X leads'; label.style.color='var(--xc)'; }
  else if (x<0.4) { label.textContent='O leads'; label.style.color='var(--oc)'; }
  else            { label.textContent='Even';    label.style.color='var(--muted)'; }
}

function refreshUndoBtn() {
  const btn = document.getElementById('btnUndo');
  if (!btn) return;
  const can = history.length>0 && !G.over && G.mode!=='online';
  btn.classList.toggle('disabled', !can);
}

function updateOnlineTurnBadge() {
  const badge = document.getElementById('onlineTurnBadge');
  if (!badge) return;
  if (G.mode!=='online') { badge.classList.remove('show'); return; }
  const myTurn = G.player===G.onlineColor && !G.over;
  badge.classList.toggle('show', !myTurn && !G.over);
}

/* ============================================================
   WIN MODAL
   ============================================================ */
function showWinModal() {
  if (!G.winLine.length) return;
  const w = G.cells[k(G.winLine[0][0],G.winLine[0][1])];
  const isBotWin = (G.mode==='medium'||G.mode==='hard') && w==='O';
  const isYouWin = G.mode==='online' && w===G.onlineColor;

  document.getElementById('modalTitle').textContent  =
    isBotWin ? 'Bot Wins!' :
    G.mode==='online' ? (isYouWin ? 'You Win!' : 'Opponent Wins!') :
    `${w} Wins!`;
  document.getElementById('modalSub').textContent =
    `Six in a row · ${G.totalMoves} move${G.totalMoves!==1?'s':''}`;
  document.getElementById('overlay').classList.add('show');
}
function hideModal() {
  document.getElementById('overlay').classList.remove('show');
}

/* ============================================================
   DISPLAY TOGGLES
   ============================================================ */
function bindToggle(id, key, extraFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = PREFS[key];
  el.addEventListener('change', () => {
    PREFS[key] = el.checked;
    if (extraFn) extraFn(el.checked);
    scheduleRender();
  });
}

/* ============================================================
   ONLINE — CREATE ROOM
   ============================================================ */
function doCreateRoom() {
  if (typeof Peer === 'undefined') {
    setCreateStatus('err', 'PeerJS not loaded. Check your connection.');
    return;
  }

  netTeardown();
  NET.role   = 'host';
  NET.code   = generateCode();
  NET.status = 'creating';

  document.getElementById('codeValue').textContent = '······';
  setCreateStatus('spinning', 'Connecting to relay server…');

  NET.peer = new Peer(peerId(NET.code));

  NET.peer.on('open', () => {
    NET.status = 'waiting';
    document.getElementById('codeValue').textContent = NET.code;
    setCreateStatus('pulse', 'Waiting for opponent to join…');
  });

  NET.peer.on('connection', conn => {
    NET.conn   = conn;
    NET.status = 'connected';
    setCreateStatus('ok', 'Opponent connected! Starting…');
    setupConnHandlers(conn);

    conn.on('open', () => {
      setTimeout(() => {
        closeOnlineModal();
        G = freshGame('online', 'X');
        history = [];
        showGame();
        updateUI();
        scheduleRender();
      }, 900);
    });
  });

  NET.peer.on('error', err => {
    console.warn('PeerJS error:', err.type, err);
    if (err.type === 'unavailable-id') {
      // Regenerate code and retry
      NET.peer.destroy();
      NET.code = generateCode();
      NET.peer = new Peer(peerId(NET.code));
    } else {
      NET.status = 'error';
      setCreateStatus('err', `Connection failed: ${err.type}`);
    }
  });
}

function setCreateStatus(dotClass, text) {
  const dot  = document.querySelector('#createStatus .status-dot');
  const span = document.getElementById('createStatusText');
  if (dot)  { dot.className = 'status-dot'; dot.classList.add(dotClass); }
  if (span) span.textContent = text;
}

/* ============================================================
   ONLINE — JOIN ROOM
   ============================================================ */
function doJoinRoom() {
  const raw  = document.getElementById('joinInput')?.value?.trim().toUpperCase() || '';
  const code = raw.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length < 6) {
    showJoinStatus('err', 'Enter a 6-character code');
    return;
  }

  if (typeof Peer === 'undefined') {
    showJoinStatus('err', 'PeerJS not loaded. Check your connection.');
    return;
  }

  netTeardown();
  NET.role   = 'guest';
  NET.code   = code;
  NET.status = 'joining';

  document.getElementById('joinBtn').disabled = true;
  showJoinStatus('spinning', 'Connecting…');

  NET.peer = new Peer();

  NET.peer.on('open', () => {
    const conn = NET.peer.connect(peerId(code), { reliable: true });
    NET.conn   = conn;
    setupConnHandlers(conn);

    conn.on('open', () => {
      NET.status = 'connected';
      showJoinStatus('ok', 'Connected! Starting…');

      setTimeout(() => {
        closeOnlineModal();
        G = freshGame('online', 'O');
        history = [];
        showGame();
        updateUI();
        scheduleRender();
      }, 900);
    });
  });

  NET.peer.on('error', err => {
    console.warn('PeerJS join error:', err.type, err);
    document.getElementById('joinBtn').disabled = false;
    const msg = err.type === 'peer-unavailable'
      ? 'Room not found. Check the code.' : `Error: ${err.type}`;
    showJoinStatus('err', msg);
  });
}

function showJoinStatus(dotClass, text) {
  const row  = document.getElementById('joinStatus');
  const dot  = document.getElementById('joinDot');
  const span = document.getElementById('joinStatusText');
  if (row)  row.classList.remove('hidden');
  if (dot)  { dot.className = 'status-dot'; dot.classList.add(dotClass); }
  if (span) span.textContent = text;
}

/* ============================================================
   ONLINE MODAL HELPERS
   ============================================================ */
function openOnlineModal(tab) {
  const modal = document.getElementById('onlineModal');
  modal.classList.add('show');
  switchOnlineTab(tab);
  if (tab === 'create') doCreateRoom();
}

function closeOnlineModal() {
  document.getElementById('onlineModal')?.classList.remove('show');
  // Reset join input
  const ji = document.getElementById('joinInput');
  if (ji) ji.value = '';
  const jb = document.getElementById('joinBtn');
  if (jb) jb.disabled = false;
  document.getElementById('joinStatus')?.classList.add('hidden');
}

function cancelOnline() {
  netTeardown();
  closeOnlineModal();
  // Reset create pane for next time
  document.getElementById('codeValue').textContent = '——————';
  setCreateStatus('', '');
}

function switchOnlineTab(tab) {
  document.getElementById('otabCreate').classList.toggle('active', tab==='create');
  document.getElementById('otabJoin').classList.toggle('active', tab==='join');
  document.getElementById('paneCreate').classList.toggle('hidden', tab!=='create');
  document.getElementById('paneJoin').classList.toggle('hidden', tab!=='join');

  if (tab === 'join') {
    // Reset join state
    document.getElementById('joinStatus')?.classList.add('hidden');
    const jb = document.getElementById('joinBtn');
    if (jb) jb.disabled = false;
  }
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM refs
  canvas = document.getElementById('gc');
  ctx    = canvas?.getContext('2d');
  wrap   = document.getElementById('canvasWrap');
  dpr    = window.devicePixelRatio || 1;

  window.addEventListener('resize', resize);
  bindCanvasEvents();

  // ── Home: mode card buttons ─────────────────────────
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'start2p') {
        G = freshGame('2p', 'X'); history = []; V.anims = {};
        showGame('2p'); updateUI(); scheduleRender();

      } else if (action === 'startMedium') {
        G = freshGame('medium', 'X'); history = []; V.anims = {};
        showGame('medium'); updateUI(); scheduleRender();

      } else if (action === 'startHard') {
        G = freshGame('hard', 'X'); history = []; V.anims = {};
        showGame('hard'); updateUI(); scheduleRender();

      } else if (action === 'openCreate') {
        openOnlineModal('create');

      } else if (action === 'openJoin') {
        openOnlineModal('join');
      }
    });
  });

  // ── Online modal controls ───────────────────────────
  document.getElementById('otabCreate').addEventListener('click', () => {
    switchOnlineTab('create');
    doCreateRoom();
  });
  document.getElementById('otabJoin').addEventListener('click', () => switchOnlineTab('join'));
  document.getElementById('onlineClose').addEventListener('click', cancelOnline);
  document.getElementById('cancelCreate').addEventListener('click', cancelOnline);
  document.getElementById('cancelJoin').addEventListener('click', cancelOnline);

  document.getElementById('copyBtn').addEventListener('click', () => {
    const code = document.getElementById('codeValue').textContent;
    if (code.length !== 6) return;
    navigator.clipboard?.writeText(code).catch(() => {});
    const btn = document.getElementById('copyBtn');
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  });

  document.getElementById('joinBtn').addEventListener('click', doJoinRoom);
  document.getElementById('joinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoinRoom();
  });
  document.getElementById('joinInput').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // ── Game header buttons ──────────────────────────────
  document.getElementById('btnBack').addEventListener('click', () => {
    V.botToken++;
    setBotBadge(false);
    if (G.mode === 'online') netTeardown();
    showHome();
  });

  document.getElementById('btnNew').addEventListener('click', startNewGame);
  document.getElementById('btnUndo').addEventListener('click', doUndo);
  document.getElementById('btnCenter').addEventListener('click', centerView);

  // ── Win modal ────────────────────────────────────────
  document.getElementById('modalPlay').addEventListener('click', startNewGame);
  document.getElementById('modalClose').addEventListener('click', hideModal);

  // ── Display toggles ──────────────────────────────────
  bindToggle('togThreats',  'showThreats',  null);
  bindToggle('togLastMove', 'showLastMove', null);
  bindToggle('togMomentum', 'showMomentum', on => {
    document.getElementById('momentumWrap').classList.toggle('hidden', !on);
  });

  // ── Init ─────────────────────────────────────────────
  resize();
  updateUI();
  // Don't start rendering until game view is shown (saves CPU on home screen)
});
