import { Game, RULES, SKINS } from './game.js';
import { Renderer, SkinPreview } from './renderer.js';

const $ = (id) => document.getElementById(id);
const field = $('game-field');
const canvas = $('game-canvas');
const game = new Game();
const renderer = new Renderer(canvas);
let skinPreview = null;
let shopPage = 'home';
let selectedCategory = 'fruit';
let selectedSkin = 'banana';
let previewAngle = 0;
let previewPointer = null;
let shopWasRunning = false;
const PROFILE_KEY = 'chicken-skin-profile-v1';
try {
  const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  if (profile) {
    game.points = Number.isSafeInteger(profile.points) && profile.points >= 0 ? profile.points : 0;
    game.unlockedSkins = new Set(SKINS.filter((skin) => skin.price === 0 || (Array.isArray(profile.skins) && profile.skins.includes(skin.id))).map((skin) => skin.id));
    game.equipSkin(profile.equipped ?? null);
  }
} catch { /* A new profile is usable when browser storage is unavailable. */ }
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ points: game.points, skins: [...game.unlockedSkins], equipped: game.equippedSkin })); } catch { /* Keep the current session playable. */ }
}
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
  $('points').textContent = game.points;
  $('jump-count').textContent = `跳过 ${game.jumpedCount} 个\n商城还需 ${15 - game.jumpedCount % 15}`;
  if ($('score').textContent !== String(game.score)) {
    $('score').textContent = String(game.score);
    $('progress').setAttribute('aria-valuenow', String(game.score));
    $('progress-fill').style.width = `${game.score / RULES.goal * 100}%`;
  }
  const hearts = $('hearts');
  hearts.setAttribute('aria-label', `剩余 ${game.hearts} 颗爱心`);
  [...hearts.children].forEach((heart, i) => {
    const fill = Math.min(1, Math.max(0, game.hearts - i));
    if (heart.children.length === 1) {
      const base = heart.firstElementChild.cloneNode(true);
      base.style.fill = '#ffffff35'; heart.prepend(base);
    }
    heart.lastElementChild.style.clipPath = `inset(0 ${(1 - fill) * 100}% 0 0)`;
  });
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
  if ($('help-dialog').open || $('shop-dialog').open) return;
  if (game.phase === 'ready') start();
  game.jump();
}

function togglePause() {
  if ($('help-dialog').open || $('shop-dialog').open) return;
  if (game.phase === 'running') game.pause();
  else if (game.phase === 'paused') { game.resume(); canvas.focus({ preventScroll: true }); }
  lastFrame = null;
  syncUI();
}

function syncShop() {
  $('shop-title').textContent = shopPage === 'home' ? '小小商城' : shopPage === 'series' ? '皮肤 · 选择系列' : selectedCategory === 'fruit' ? '水果系列' : '动物系列';
  $('shop-points').textContent = game.points;
  $('equipped-label').textContent = `穿戴：${SKINS.find((skin) => skin.id === game.equippedSkin)?.name ?? '小鸡'}`;
  $('shop-home').hidden = shopPage !== 'home';
  $('shop-series').hidden = shopPage !== 'series';
  $('shop-catalog').hidden = shopPage !== 'catalog';
  $('shop-back').hidden = shopPage === 'home';
  if (shopPage !== 'catalog') return;
  const skin = SKINS.find((item) => item.id === selectedSkin);
  $('skin-list').replaceChildren(...SKINS.filter((item) => item.category === selectedCategory).map((item) => {
    const button = document.createElement('button'); button.className = 'skin-choice';
    button.setAttribute('aria-pressed', String(item.id === selectedSkin));
    button.textContent = item.name;
    const label = document.createElement('span');
    label.textContent = game.equippedSkin === item.id ? '已穿戴' : item.price === 0 ? '免费 · 直接穿戴' : game.unlockedSkins.has(item.id) ? '已解锁' : `★ ${item.price} 积分`;
    button.append(label);
    button.addEventListener('click', () => { selectedSkin = item.id; previewAngle = 0; $('skin-angle').value = 0; clearPurchase(); syncShop(); activateSkin(); });
    return button;
  }));
  $('skin-name').textContent = `${skin.name}外套 · ${skin.price === 0 ? '免费' : `${skin.price} 积分`}`;
  $('skin-action').textContent = game.equippedSkin === skin.id ? '已穿戴' : game.unlockedSkins.has(skin.id) ? '穿戴皮肤' : '兑换解锁';
  $('skin-action').disabled = game.equippedSkin === skin.id;
  skinPreview ??= new SkinPreview($('skin-preview'), renderer);
  skinPreview.render(selectedSkin, previewAngle);
}
function clearPurchase() { $('purchase-confirm').hidden = true; $('shop-status').textContent = ''; }
function openShop() {
  if (!game.shopAvailable) return;
  shopWasRunning = game.phase === 'running'; game.pause(); keys.clear(); pointers.clear();
  shopPage = 'home'; clearPurchase(); $('shop-dialog').showModal(); syncShop(); syncUI();
}
$('shop-button').addEventListener('click', openShop);
$('skins-entry').addEventListener('click', () => { shopPage = 'series'; syncShop(); });
for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => {
  selectedCategory = button.dataset.category;
  selectedSkin = SKINS.find((skin) => skin.category === selectedCategory).id;
  shopPage = 'catalog'; previewAngle = 0; $('skin-angle').value = 0; clearPurchase(); syncShop();
});
$('shop-back').addEventListener('click', () => { shopPage = shopPage === 'catalog' ? 'series' : 'home'; clearPurchase(); syncShop(); });
function activateSkin() {
  clearPurchase();
  if (game.unlockedSkins.has(selectedSkin)) {
    game.equipSkin(selectedSkin); saveProfile(); syncShop(); $('shop-status').textContent = '已穿戴，每次只能穿一件皮肤。'; return;
  }
  const result = game.unlockSkin(selectedSkin);
  if (result === 'insufficient') { $('shop-status').textContent = '积分不足，收集更多金色星星再来吧！'; return; }
  const skin = SKINS.find((item) => item.id === selectedSkin);
  $('purchase-copy').textContent = `确定用 ${skin.price} 积分兑换「${skin.name}」吗？`;
  $('purchase-confirm').hidden = false;
}
$('skin-action').addEventListener('click', activateSkin);
$('confirm-purchase').addEventListener('click', () => {
  const result = game.unlockSkin(selectedSkin, true); clearPurchase(); saveProfile(); syncShop(); syncUI();
  $('shop-status').textContent = result === 'insufficient' ? '积分不足' : '解锁成功！点击「穿戴皮肤」即可穿上。';
});
$('cancel-purchase').addEventListener('click', clearPurchase);
$('remove-skin').addEventListener('click', () => { game.equipSkin(null); saveProfile(); syncShop(); });
for (const id of ['close-shop', 'shop-done']) $(id).addEventListener('click', () => $('shop-dialog').close());
$('shop-dialog').addEventListener('close', () => {
  game.shopAvailable = game.shops.length > 0; clearPurchase(); previewPointer = null;
  if (shopWasRunning && !document.hidden) game.resume();
  lastFrame = null; syncUI(); canvas.focus({ preventScroll: true });
});
$('skin-angle').addEventListener('input', () => { previewAngle = Number($('skin-angle').value) * Math.PI / 180; });
$('skin-preview').addEventListener('pointerdown', (event) => {
  previewPointer = { id: event.pointerId, x: event.clientX, angle: previewAngle };
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('skin-preview').addEventListener('pointermove', (event) => {
  if (previewPointer?.id !== event.pointerId) return;
  previewAngle = previewPointer.angle + (event.clientX - previewPointer.x) * .015;
  $('skin-angle').value = ((previewAngle * 180 / Math.PI + 180) % 360 + 360) % 360 - 180;
});
for (const type of ['pointerup', 'pointercancel']) $('skin-preview').addEventListener(type, () => { previewPointer = null; });

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
  if (game.shopAvailable && renderer.isShopAt(event.clientX, event.clientY)) {
    event.preventDefault(); openShop(); return;
  }
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
  if ($('help-dialog').open || $('shop-dialog').open) return;
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
    if ($('help-dialog').open || $('shop-dialog').open) return;
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
    if (event.type === 'star-collected') saveProfile();
    if (event.type === 'heal') showToast('跳满 10 个障碍，回复 1/10 颗爱心！');
    if (event.type === 'shop-spawn') showToast('跳满 15 个障碍，积分商城出现啦！点击路边的小房子。');
    if (event.type === 'net-warning') showToast('注意前方！深绿色渔网即将落下。', 1.5);
    if (event.type === 'net-release') showToast('挣脱啦！看准空隙再跳。', 1.3);
  }
  syncUI();
  renderer.render(game);
  const shopTarget = game.shopAvailable && ['running', 'paused'].includes(game.phase) && !$('shop-dialog').open ? renderer.shopTarget() : null;
  $('shop-button').hidden = !shopTarget;
  if (shopTarget) Object.assign($('shop-button').style, {
    left: `${shopTarget.left}px`, top: `${shopTarget.top}px`, width: `${shopTarget.width}px`, height: `${shopTarget.height}px`,
  });
  if ($('shop-dialog').open && shopPage === 'catalog') skinPreview?.render(selectedSkin, previewAngle);
  if (toastUntil && timestamp >= toastUntil) { $('toast').hidden = true; toastUntil = 0; }
  requestAnimationFrame(frame);
}

syncUI();
renderer.render(game);
requestAnimationFrame(frame);
