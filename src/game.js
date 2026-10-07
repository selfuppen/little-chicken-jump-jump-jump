export const RULES = Object.freeze({
  width: 960, height: 480, ground: 382, chickenX: 186,
  gravity: 1850, jumpVelocity: -780, oceanJumpSpeed: 1.35,
  baseSpeed: 260, speedPerPoint: 0.8, maxSpeed: 500,
  goal: 1000, invincibility: 1.2, returnSafety: 1.5,
  netStickTime: 0.7, netFallDuration: 0.42, netWarningMin: 0.95,
  netDropX: 720,
  lanes: 3, laneSwitchTime: 0.18, spawnX: 2100,
  laneWidth: 2.35, worldScale: 0.018,
});

export const SKINS = Object.freeze([
  { id: 'pig', name: '小猪', price: 100, category: 'animal' },
  { id: 'cat', name: '小猫', price: 30, category: 'animal' },
  { id: 'dog', name: '小狗', price: 40, category: 'animal' },
  { id: 'rabbit', name: '兔子', price: 20, category: 'animal' },
  { id: 'panda', name: '熊猫', price: 80, category: 'animal' },
  { id: 'bear', name: '小熊', price: 60, category: 'animal' },
  { id: 'banana', name: '香蕉', price: 50, category: 'fruit' },
  { id: 'dragonfruit', name: '火龙果', price: 10, category: 'fruit' },
  { id: 'apple', name: '苹果', price: 0, category: 'fruit' },
  { id: 'orange', name: '橙子', price: 0, category: 'fruit' },
  { id: 'watermelon', name: '西瓜', price: 60, category: 'fruit' },
  { id: 'strawberry', name: '草莓', price: 40, category: 'fruit' },
  { id: 'grape', name: '葡萄', price: 70, category: 'fruit' },
].map((skin) => Object.freeze(skin)));

const GRASS_OBSTACLES = Object.freeze(['bone', 'fishbone', 'branch', 'applecore', 'can']);
const OCEAN_OBSTACLES = Object.freeze(['bottle', 'blackbag', 'clearbag']);

export const speedForScore = (score) => Math.min(RULES.maxSpeed, RULES.baseSpeed + Math.max(0, score) * RULES.speedPerPoint);
export const netWarningForScore = (score) => Math.max(RULES.netWarningMin, 1.7 - Math.max(0, score) * 0.0012);

export class Game {
  constructor(random = Math.random) {
    this.random = random;
    this.points = 0;
    this.unlockedSkins = new Set(SKINS.filter((skin) => skin.price === 0).map((skin) => skin.id));
    this.equippedSkin = null;
    this.reset();
  }

  reset() {
    this.phase = 'ready';
    this.world = 'grass';
    this.score = 0;
    this.jumpedCount = 0;
    this.shopAvailable = false;
    this.stars = [];
    this.shops = [];
    this.starSpawnIn = 1;
    this.hearts = 3;
    this.time = 0;
    this.distance = 0;
    this.oceanTime = 0;
    this.grassTrack = null;
    this.invincible = 0;
    this.player = { y: RULES.ground, vy: 0, squash: 0, stuckRemaining: 0, lane: 1, lanePosition: 1 };
    this.caughtNet = null;
    this.obstacles = [];
    this.spawnIn = 0.05;
    this.regularCount = 0;
    this.pipeAfter = this.randomPipeInterval();
    this.nextId = 1;
    this.events = [];
  }

  get speed() { return speedForScore(this.score); }
  get jumpSpeedFactor() { return this.world === 'ocean' ? RULES.oceanJumpSpeed : 1; }
  get grounded() { return this.player.y >= RULES.ground && this.player.vy === 0; }

  start() { this.reset(); this.phase = 'running'; this.emit('start'); }
  pause() { if (this.phase === 'running') { this.phase = 'paused'; return true; } return false; }
  resume() { if (this.phase === 'paused') { this.phase = 'running'; return true; } return false; }

  jump() {
    if (this.phase !== 'running' || this.player.stuckRemaining > 0) return false;
    if (!this.grounded) return false;
    this.player.vy = RULES.jumpVelocity * this.jumpSpeedFactor;
    this.player.squash = 0;
    this.emit('jump');
    return true;
  }

  moveLane(direction) {
    if (this.phase !== 'running' || this.player.stuckRemaining > 0 || ![-1, 1].includes(direction)) return false;
    const lane = this.player.lane + direction;
    if (lane < 0 || lane >= RULES.lanes) return false;
    this.player.lane = lane;
    this.emit('lane-change', { lane });
    return true;
  }

  unlockSkin(id, confirmed = false) {
    const skin = SKINS.find((value) => value.id === id);
    if (!skin) return 'invalid';
    if (this.unlockedSkins.has(id)) return 'owned';
    if (this.points < skin.price) return 'insufficient';
    if (!confirmed) return 'confirmation';
    this.points -= skin.price;
    this.unlockedSkins.add(id);
    this.emit('skin-unlocked', { skin: id });
    return 'unlocked';
  }

  equipSkin(id) {
    if (id !== null && !this.unlockedSkins.has(id)) return false;
    this.equippedSkin = id;
    return true;
  }

  recordJumpedObstacle() {
    this.jumpedCount++;
    if (this.jumpedCount % 10 === 0) {
      this.hearts = Math.min(3, Math.round((this.hearts + .1) * 10) / 10);
      this.emit('heal');
    }
    if (this.jumpedCount % 15 === 0) {
      this.shopAvailable = true;
      this.shops.push({ id: this.nextId++, x: RULES.spawnX });
      this.emit('shop-spawn');
    }
  }

  spawnStar() {
    const lane = Math.floor(this.random() * RULES.lanes);
    const x = RULES.spawnX;
    // Reserve the whole pipe row, even when it lies in another lane.
    if (this.obstacles.some((o) => o.kind === 'pipe' && Math.abs(o.x - x) < 160)) return;
    this.stars.push({ id: this.nextId++, x, lane, height: 25 + this.random() * 65 });
  }

  updateRewards(dt, motion) {
    this.starSpawnIn -= dt;
    if (this.starSpawnIn <= 0) {
      this.spawnStar();
      this.starSpawnIn = 1.2 + this.random() * 1.8;
    }
    for (const star of this.stars) {
      star.x -= motion;
      const height = star.height + Math.sin(this.time * 2 + star.id) * 7;
      if (Math.abs(star.x - RULES.chickenX) < 28 &&
          Math.abs(this.player.lanePosition - star.lane) < .42 &&
          Math.abs(RULES.ground - this.player.y + 24 - height) < 30) {
        star.collected = true;
        this.points++;
        this.emit('star-collected');
      }
    }
    this.stars = this.stars.filter((star) => !star.collected && star.x > -80);
    for (const shop of this.shops) {
      shop.x -= motion;
      if (shop.x <= RULES.chickenX) { shop.arrived = true; this.emit('shop-arrive'); }
    }
    this.shops = this.shops.filter((shop) => !shop.arrived);
  }

  randomPipeInterval() {
    return this.world === 'ocean' ? 6 + Math.floor(this.random() * 5) : 14 + Math.floor(this.random() * 9);
  }

  emit(type, extra = {}) { this.events.push({ type, time: this.time, ...extra }); }
  drainEvents() { return this.events.splice(0); }

  createObstacle(kind, x = RULES.spawnX, lane = 1) {
    const sizes = { bone: [47, 43], fishbone: [65, 39], branch: [64, 34], applecore: [36, 44], can: [43, 37], pipe: [100, 88], oldnet: [66, 40], fallingnet: [82, 60], bottle: [58, 42], blackbag: [66, 48], clearbag: [66, 48] };
    const [width, height] = sizes[kind];
    const obstacle = { id: this.nextId++, kind, x, lane, width, height, hit: false, cleared: false, passed: false };
    if (kind === 'fallingnet') {
      obstacle.stage = 'warning';
      obstacle.warningDuration = netWarningForScore(this.score);
      obstacle.warningRemaining = obstacle.warningDuration;
      obstacle.fallElapsed = 0;
      obstacle.bottom = 146;
    }
    return obstacle;
  }

  spawn() {
    const ocean = this.world === 'ocean';
    const isPipe = this.regularCount >= this.pipeAfter;
    const count = Math.floor(this.random() * 4);
    this.spawnIn = (ocean ? 1.6 : 1.35) + this.random() * 0.5;
    if (count === 0) return;
    // Pipes occupy one randomly selected lane; ordinary rows can occupy 1–3.
    const lanes = [0, 1, 2];
    let warningTime = 0;
    const choices = ocean ? OCEAN_OBSTACLES : GRASS_OBSTACLES;
    const row = this.nextId;
    for (let i = 0; i < (isPipe ? 1 : count); i++) {
      const lane = lanes.splice(Math.floor(this.random() * lanes.length), 1)[0];
      // Both kinds of net share a 1.5% chance, rather than each getting 1.5%.
      const net = ocean && !isPipe && this.random() < .015;
      const kind = isPipe ? 'pipe' : net ? this.random() < .5 ? 'oldnet' : 'fallingnet' : choices[Math.floor(this.random() * choices.length)];
      const obstacle = this.createObstacle(kind, RULES.spawnX, lane);
      obstacle.row = row;
      this.obstacles.push(obstacle);
      if (!isPipe) {
        this.regularCount++;
      }
      if (kind === 'fallingnet') warningTime = Math.max(warningTime, obstacle.warningDuration + RULES.netFallDuration);
    }
    if (isPipe) {
      this.stars = this.stars.filter((star) => Math.abs(star.x - RULES.spawnX) >= 160);
      this.regularCount = 0;
      this.pipeAfter = this.randomPipeInterval();
      this.spawnIn += .35;
    }
    if (warningTime) {
      this.spawnIn += warningTime;
      this.emit('net-warning');
    }
  }

  enterOcean(pipe) {
    this.grassTrack = {
      obstacles: this.obstacles.filter((obstacle) => obstacle !== pipe),
      stars: this.stars, shops: this.shops, starSpawnIn: this.starSpawnIn,
      spawnIn: this.spawnIn, regularCount: this.regularCount, pipeAfter: this.pipeAfter, distance: this.distance,
    };
    this.world = 'ocean';
    this.stars = []; this.shops = []; this.starSpawnIn = 1;
    this.oceanTime = 0;
    this.distance = 0;
    this.obstacles = [];
    this.spawnIn = 0.25;
    this.regularCount = 0;
    this.pipeAfter = this.randomPipeInterval();
    this.player.y = RULES.ground;
    this.player.vy = 0;
    this.player.stuckRemaining = 0;
    this.caughtNet = null;
    this.emit('ocean-enter');
  }

  returnToGrass() {
    this.world = 'grass';
    this.player.y = RULES.ground;
    this.player.vy = 0;
    this.player.squash = 1;
    this.player.stuckRemaining = 0;
    this.caughtNet = null;
    const track = this.grassTrack;
    this.obstacles = track?.obstacles ?? [];
    this.stars = track?.stars ?? []; this.shops = track?.shops ?? [];
    this.starSpawnIn = track?.starSpawnIn ?? 1;
    this.distance = track?.distance ?? 0;
    this.regularCount = track?.regularCount ?? 0;
    this.pipeAfter = track?.pipeAfter ?? this.randomPipeInterval();
    this.spawnIn = track?.spawnIn ?? RULES.returnSafety;
    this.grassTrack = null;
    const nearestSafeX = RULES.chickenX + 18 + this.speed * RULES.returnSafety;
    const ahead = this.obstacles.filter((obstacle) => obstacle.x + obstacle.width > RULES.chickenX - 18);
    const shift = ahead.length ? Math.max(0, nearestSafeX - Math.min(...ahead.map((obstacle) => obstacle.x))) : 0;
    this.obstacles = ahead;
    for (const obstacle of this.obstacles) obstacle.x += shift;
    for (const reward of [...this.stars, ...this.shops]) reward.x += shift;
    this.spawnIn = Math.max(this.spawnIn, RULES.returnSafety);
    this.emit('ocean-exit');
  }

  touchObstacle(obstacle) {
    obstacle.hit = true;
    if (this.invincible > 0) return;
    this.hearts = Math.max(0, Math.round((this.hearts - 1) * 10) / 10);
    this.invincible = RULES.invincibility;
    const net = obstacle.kind === 'oldnet' || obstacle.kind === 'fallingnet';
    if (net) {
      this.player.stuckRemaining = RULES.netStickTime;
      this.player.y = RULES.ground - obstacle.height + 8;
      this.player.vy = 0;
      this.caughtNet = obstacle;
    }
    this.emit('damage', { lane: this.player.lanePosition, y: this.player.y - 25, net });
    if (this.hearts <= 0) { this.phase = 'gameover'; this.emit('gameover'); }
  }

  updateFallingNet(obstacle, dt) {
    if (obstacle.stage === 'warning') {
      obstacle.warningRemaining = Math.max(0, obstacle.warningRemaining - dt);
      if (obstacle.warningRemaining === 0) obstacle.stage = 'falling';
    } else if (obstacle.stage === 'falling') {
      obstacle.fallElapsed = Math.min(RULES.netFallDuration, obstacle.fallElapsed + dt);
      const progress = obstacle.fallElapsed / RULES.netFallDuration;
      obstacle.bottom = 146 + (RULES.ground - 146) * progress * progress;
      if (progress === 1) { obstacle.stage = 'landed'; this.emit('net-land'); }
    }
  }

  update(dt) {
    if (this.phase !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
    // Substeps keep collision/pipe detection consistent on low-refresh devices.
    const duration = Math.min(dt, 0.05);
    const steps = Math.ceil(duration / (1 / 120));
    for (let i = 0; i < steps && this.phase === 'running'; i++) this.step(duration / steps);
  }

  step(dt) {
    this.time += dt;
    if (this.world === 'ocean') this.oceanTime += dt;

    this.invincible = Math.max(0, this.invincible - dt);
    this.player.squash = Math.max(0, this.player.squash - dt * 5);
    if (this.player.stuckRemaining > 0) {
      this.player.stuckRemaining = Math.max(0, this.player.stuckRemaining - dt);
      if (this.player.stuckRemaining === 0) {
        if (this.caughtNet) this.caughtNet.x = RULES.chickenX - 28 - this.caughtNet.width;
        this.caughtNet = null;
        this.player.y = RULES.ground;
        this.player.vy = 0;
        this.player.squash = 1;
        this.emit('net-release');
      }
      return;
    }
    const oldY = this.player.y;
    const laneDelta = this.player.lane - this.player.lanePosition;
    this.player.lanePosition += Math.sign(laneDelta) * Math.min(Math.abs(laneDelta), dt / RULES.laneSwitchTime);
    if (Math.abs(this.player.lane - this.player.lanePosition) < 1e-8) this.player.lanePosition = this.player.lane;
    if (!this.grounded) {
      // Scale launch speed and gravity together for a quicker jump at the same height.
      this.player.vy += RULES.gravity * this.jumpSpeedFactor ** 2 * dt;
      this.player.y += this.player.vy * dt;
      if (this.player.y >= RULES.ground) {
        this.player.y = RULES.ground;
        this.player.vy = 0;
        this.player.squash = 1;
        this.emit('land');
      }
    }

    const motion = this.speed * dt;
    this.distance += motion;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) this.spawn();
    this.updateRewards(dt, motion);
    const heldRows = new Set(this.obstacles.filter((o) => o.kind === 'fallingnet' && o.stage !== 'landed').map((o) => o.row).filter((row) => row !== undefined));
    for (const obstacle of this.obstacles) {
      if (obstacle.kind === 'fallingnet' && obstacle.stage !== 'landed') {
        this.updateFallingNet(obstacle, dt);
        // Nets drop ahead of the chicken before joining the scrolling course.
        // Their held position guarantees reaction distance even at maximum speed.
        continue;
      }
      if (heldRows.has(obstacle.row)) continue;
      obstacle.x -= motion;
      const top = RULES.ground - obstacle.height;
      const sameLane = Math.abs(this.player.lanePosition - obstacle.lane) < 0.42;
      if (sameLane && obstacle.kind === 'pipe' && !obstacle.hit && this.player.vy > 0 &&
          oldY <= top && this.player.y >= top &&
          RULES.chickenX >= obstacle.x + 12 && RULES.chickenX <= obstacle.x + obstacle.width - 12) {
        if (this.world === 'ocean') this.returnToGrass();
        else this.enterOcean(obstacle);
        return;
      }

      const overlaps = RULES.chickenX + 18 > obstacle.x && RULES.chickenX - 18 < obstacle.x + obstacle.width;
      if (sameLane && overlaps) {
        if (this.player.y <= top + 4) obstacle.cleared = true;
        const touches = this.player.y - 5 > top && this.player.y - 48 < RULES.ground;
        if (touches && !obstacle.hit) {
          this.touchObstacle(obstacle);
          if (this.phase !== 'running' || this.player.stuckRemaining > 0) return;
        }
      }

      if (!obstacle.passed && obstacle.x + obstacle.width < RULES.chickenX - 18) {
        obstacle.passed = true;
        if (!obstacle.hit) {
          if (obstacle.cleared && obstacle.kind !== 'pipe') this.recordJumpedObstacle();
          this.score = Math.min(RULES.goal, this.score + 1);
          this.emit('score', { lane: this.player.lanePosition, y: this.player.y - 70 });
          if (this.score === RULES.goal) { this.phase = 'won'; this.emit('win'); return; }
        }
      }
    }
    this.obstacles = this.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -80);
  }
}
