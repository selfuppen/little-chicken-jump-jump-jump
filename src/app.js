import { Game, RULES } from './game.js';
import { Renderer } from './renderer.js';

const $ = (id) => document.getElementById(id);
const field = $('game-field');
const canvas = $('game-canvas');
const game = new Game();
const renderer = new Renderer(canvas);
const keys = new Set();
const pointers = new Map();
const RETRY_DELAY_MS = 2500;
let lastFrame = null;
let shownPhase = null;
let shownCard = null;
let shownWorld = null;
let toastUntil = 0;
let retryReadyAt = null;

const cards = {
  ready: { badge: '三条小路，一场 3D 冒险', title: '准备好向前跑了吗？', copy: '换道、跳跃，躲开路上的小障碍。<br />发现管道，再去海里转一圈。', button: '开始冒险', hint: '电脑：← → 换道 · ↑ 跳跃\n手机：轻点跳跃 · 左右滑动换道' },
  paused: { badge: '小鸡正在歇歇脚', title: '休息一下，再出发。', copy: '蓝天和小草都会等你。<br />准备好了，就接着蹦蹦跳跳。', button: '继续冒险', hint: '按 P 或 Esc 也可以继续' },
  gameover: { badge: '每一次尝试，都值得一个抱抱', title: '小鸡要歇一会儿啦。', copy: '', button: '再试一次', hint: '新一局，三颗满满的勇气' },
  won: { badge: '1000 次小跳跃，1000 份小快乐', title: '通关啦！你太棒了！', copy: '小鸡把一路的快乐带回了家。<br />谢谢你，勇敢的小冒险家。', button: '再玩一次', hint: '草地和海洋，期待与你再见' },
};

function showToast(message, seconds = 2.4) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastUntil = performance.now() + seconds * 1000;
}

function syncUI() {
  if ($('score').textContent !== String(game.score)) {
    $('score').textContent = String(game.score);
    $('progress').setAttribute('aria-valuenow', String(game.score));
    $('progress-fill').style.width = `${game.score / RULES.goal * 100}%`;
  }
  const hearts = $('hearts');
  hearts.setAttribute('aria-label', `剩余 ${game.hearts} 颗爱心`);
  [...hearts.children].forEach((heart, i) => heart.classList.toggle('lost', i >= game.hearts));
  $('speed-label').textContent = `速度 ×${(game.speed / RULES.baseSpeed).toFixed(2)}`;
  const stuck = game.player.stuckRemaining > 0;
  field.dataset.stuck = String(stuck);
  $('jump-button').disabled = !['ready', 'running'].includes(game.phase) || stuck;
  $('jump-button').setAttribute('aria-label', stuck ? '正在挣脱渔网' : '跳一下');

  if (shownPhase !== game.phase) {
    shownPhase = game.phase;
    field.dataset.phase = game.phase;
    retryReadyAt = game.phase === 'gameover' ? performance.now() + RETRY_DELAY_MS : null;
    if (game.phase === 'gameover') canvas.focus({ preventScroll: true });
    $('pause-button').hidden = !['running', 'paused'].includes(game.phase);
    $('pause-button').setAttribute('aria-label', game.phase === 'paused' ? '继续游戏' : '暂停游戏');
    $('pause-button').querySelector('span').textContent = game.phase === 'paused' ? '继续' : '暂停';
    $('restart-button').hidden = game.phase !== 'paused';
  }

  const retryWaiting = game.phase === 'gameover' && performance.now() < retryReadyAt;
  const cardPhase = retryWaiting || !cards[game.phase] ? null : game.phase;
  const card = cards[cardPhase];
  $('overlay').hidden = !card;
  $('primary-button').disabled = !card;
  if (shownCard !== cardPhase) {
    shownCard = cardPhase;
    if (card) {
      $('card-badge').textContent = card.badge;
      $('card-title').textContent = card.title;
      $('card-copy').innerHTML = game.phase === 'gameover' ? `这次成功越过了 <strong>${game.score}</strong> 个障碍。<br />再来一次，小鸡会跳得更远！` : card.copy;
      $('primary-label').textContent = card.button;
      $('card-hint').textContent = card.hint;
      $('overlay-card').style.animation = 'none';
      void $('overlay-card').offsetWidth;
      $('overlay-card').style.animation = '';
      if (['gameover', 'won'].includes(game.phase)) $('primary-button').focus({ preventScroll: true });
    }
  }

  if (shownWorld !== game.world) {
    const changing = shownWorld !== null && game.phase === 'running';
    shownWorld = game.world;
    const ocean = game.world === 'ocean';
    field.dataset.world = game.world;
    $('world-label').textContent = ocean ? '海底冒险' : '草地漫游';
    $('world-icon').textContent = ocean ? '≈' : '✿';
    $('world-hint').textContent = ocean ? '躲开塑料垃圾，深绿管道带你回家' : '三条小路，向前出发';
    if (changing) {
      field.classList.remove('arriving');
      void field.offsetWidth;
      field.classList.add('arriving');
      showToast(ocean ? '海洋冒险！小心塑料瓶和塑料袋，偶尔还有渔网。' : '回来啦！继续你的小冒险吧。', ocean ? 4 : 2.4);
    }
  }
}

function start() {
  if (game.phase === 'gameover' && (retryReadyAt === null || performance.now() < retryReadyAt)) return;
  $('toast').hidden = true;
  toastUntil = 0;
  field.classList.remove('arriving');
  game.start();
  // Treat a restart as a fresh scene, rather than an ocean exit.
  shownWorld = null;
  lastFrame = null;
  syncUI();
  canvas.focus({ preventScroll: true });
}

function action() {
  if ($('help-dialog').open) return;
  if (game.phase === 'ready') start();
  game.jump();
}

function togglePause() {
  if ($('help-dialog').open) return;
  if (game.phase === 'running') game.pause();
  else if (game.phase === 'paused') { game.resume(); canvas.focus({ preventScroll: true }); }
  lastFrame = null;
  syncUI();
}

$('primary-button').addEventListener('click', () => {
  if ($('overlay').hidden || $('primary-button').disabled) return;
  if (game.phase === 'paused') { game.resume(); lastFrame = null; syncUI(); canvas.focus({ preventScroll: true }); }
  else start();
});
$('restart-button').addEventListener('click', start);
$('jump-button').addEventListener('click', action);
$('pause-button').addEventListener('click', togglePause);

field.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button') || !$('overlay').hidden || !event.isPrimary || game.phase !== 'running') return;
  if (event.pointerType === 'mouse') {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    game.moveLane(event.button === 0 ? -1 : 1);
    return;
  }
  if (pointers.size) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now() });
  field.setPointerCapture(event.pointerId);
  event.preventDefault();
  canvas.focus({ preventScroll: true });
});
field.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('pointerup', (event) => {
  const start = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (!start || game.phase !== 'running' || $('help-dialog').open) return;
  const dx = event.clientX - start.x, dy = event.clientY - start.y;
  if (Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy) * 1.25) game.moveLane(dx < 0 ? -1 : 1);
  else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && performance.now() - start.time < 500) action();
});
window.addEventListener('pointercancel', (event) => pointers.delete(event.pointerId));

window.addEventListener('keydown', (event) => {
  if ($('help-dialog').open) return;
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
    const held = event.repeat || keys.has(event.code);
    keys.add(event.code);
    event.preventDefault();
    if (!held) game.moveLane(event.code === 'ArrowLeft' ? -1 : 1);
  } else if (event.code === 'ArrowUp' || event.code === 'Space' || event.code === 'Enter') {
    const held = event.repeat || keys.has(event.code);
    keys.add(event.code);
    if (game.phase === 'gameover') {
      if (event.target instanceof Element && event.target.closest('button, a') && !event.target.closest('#primary-button')) return;
      // A retry needs a fresh press after the card appears, even if a key was held at impact.
      event.preventDefault();
      if (!held && !$('overlay').hidden) start();
      return;
    }
    if (event.code === 'Enter') return;
    // Native button keyboard activation remains available, without a second jump.
    if (event.target instanceof Element && event.target.closest('button, a, dialog')) return;
    event.preventDefault();
    if (held) return;
    action();
  } else if (event.code === 'KeyP' || event.code === 'Escape') {
    if ($('help-dialog').open) return;
    if (event.repeat) return;
    event.preventDefault();
    togglePause();
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if ($('help-dialog').open || (event.target instanceof Element && event.target.closest('button, a') && !event.target.closest('#primary-button'))) return;
  if (game.phase === 'gameover' && ['ArrowUp', 'Space', 'Enter'].includes(event.code)) event.preventDefault();
});

function pauseForVisibility() {
  keys.clear(); pointers.clear();
  if (game.pause()) { lastFrame = null; syncUI(); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseForVisibility(); });
window.addEventListener('blur', pauseForVisibility);

$('help-button').addEventListener('click', () => {
  if (game.pause()) { lastFrame = null; syncUI(); }
  $('help-dialog').showModal();
});
const closeHelp = () => $('help-dialog').close();
$('close-help').addEventListener('click', closeHelp);
$('help-done').addEventListener('click', closeHelp);
$('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) { const box = $('help-dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeHelp(); } });
field.addEventListener('animationend', () => field.classList.remove('arriving'));

new ResizeObserver(() => { renderer.resize(); renderer.render(game); }).observe(field);

function frame(timestamp) {
  const dt = lastFrame === null ? 0 : (timestamp - lastFrame) / 1000;
  lastFrame = timestamp;
  game.update(dt);
  for (const event of game.drainEvents()) {
    renderer.effect(event);
    if (event.type === 'damage') showToast(game.hearts ? event.net ? '被渔网粘住啦！扣一颗爱心，稍等一下挣脱。' : '没关系，还有勇气继续跳！' : '小鸡累啦，歇一歇再出发。', 1.6);
    if (event.type === 'net-warning') showToast('注意前方！深绿色渔网即将落下。', 1.5);
    if (event.type === 'net-release') showToast('挣脱啦！看准空隙再跳。', 1.3);
  }
  syncUI();
  renderer.render(game);
  if (toastUntil && timestamp >= toastUntil) { $('toast').hidden = true; toastUntil = 0; }
  requestAnimationFrame(frame);
}

syncUI();
renderer.render(game);
requestAnimationFrame(frame);
