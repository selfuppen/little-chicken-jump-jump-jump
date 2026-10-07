import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, speedForScore, netWarningForScore } from '../src/game.js';

function running() { const game = new Game(() => .5); game.start(); game.spawnIn = 100; return game; }
function advance(game, seconds) { for (let t = 0; t < seconds - 1e-9; t += 1 / 120) game.update(Math.min(1 / 120, seconds - t)); }
function obstacle(game, kind, x) { const value = game.createObstacle(kind, x); game.obstacles.push(value); return value; }
function underwater() { const game = running(); game.enterOcean(game.createObstacle('pipe')); game.spawnIn = 100; return game; }

test('a fresh run resets hearts, speed, score, world, and obstacles', () => {
  const game = running(); game.score = 40; game.hearts = 1; game.world = 'ocean'; obstacle(game, 'bone', 400);
  game.start();
  assert.equal(game.phase, 'running'); assert.equal(game.score, 0); assert.equal(game.hearts, 3);
  assert.equal(game.speed, 260); assert.equal(game.world, 'grass'); assert.deepEqual(game.obstacles, []);
});

test('empty jumps do not score, and airborne jumps are rejected', () => {
  const game = running(); assert.equal(game.jump(), true); assert.equal(game.jump(), false);
  advance(game, .9); assert.equal(game.grounded, true); assert.equal(game.score, 0); assert.equal(game.jump(), true);
});

for (const score of [0, 300, 999]) {
  for (const kind of ['bone', 'fishbone', 'branch', 'applecore', 'can', 'pipe']) {
    test(`${kind} can be jumped completely at score ${score}, and scores exactly once`, () => {
      const game = running(); game.score = score;
      // Pipe is crossed on the ascending portion, rather than landed inside.
      const arrivalTime = kind === 'pipe' ? .22 : .38;
      const value = obstacle(game, kind, RULES.chickenX + game.speed * arrivalTime);
      game.jump(); advance(game, .9);
      assert.equal(value.hit, false); assert.equal(game.world, 'grass'); assert.equal(game.score, score + 1);
      advance(game, 1); assert.equal(game.score, score + 1);
      if (score === 999) assert.equal(game.phase, 'won');
    });
  }
}

test('contact with one obstacle loses only one heart and never scores', () => {
  const game = running(); obstacle(game, 'bone', RULES.chickenX + 15);
  advance(game, .2); assert.equal(game.hearts, 2); assert.ok(game.invincible > 0);
  advance(game, .8); assert.equal(game.hearts, 2); assert.equal(game.score, 0);
});

for (const kind of ['branch', 'applecore', 'can']) {
  test(`grass ${kind} damages once on contact and cannot score`, () => {
    const game = running(); obstacle(game, kind, RULES.chickenX + 10);
    advance(game, 1);
    assert.equal(game.hearts, 2); assert.equal(game.score, 0);
  });
}

test('grass randomly spawns bones, dry branches, apple cores, and discarded cans', () => {
  const kinds = [0, .2, .4, .6, .8].map((sample) => {
    const game = running();
    const samples = [.3, .5, .5, sample];
    game.random = () => samples.shift() ?? .5;
    game.spawn();
    return game.obstacles[0].kind;
  });
  assert.deepEqual(kinds, ['bone', 'fishbone', 'branch', 'applecore', 'can']);
});

test('ocean jumps land sooner at the same height and restore grass timing on return', () => {
  const grass = running(); const ocean = underwater();
  grass.jump(); ocean.jump();
  const measure = (game) => {
    let airtime = 0; let peak = RULES.ground;
    while (!game.grounded && airtime < 2) {
      game.update(1 / 120); airtime += 1 / 120; peak = Math.min(peak, game.player.y);
    }
    return { airtime, height: RULES.ground - peak };
  };
  const normal = measure(grass); const quicker = measure(ocean);
  assert.ok(quicker.airtime < normal.airtime * .8);
  assert.ok(Math.abs(quicker.height - normal.height) < 2);
  assert.equal(ocean.world, 'ocean'); assert.equal(ocean.score, 0);
  ocean.returnToGrass(); ocean.jump();
  assert.deepEqual(measure(ocean), normal);
});

test('invincibility protects hearts for 1.2 seconds, without awarding collision points', () => {
  const game = running(); obstacle(game, 'bone', RULES.chickenX + 15); advance(game, .02);
  obstacle(game, 'fishbone', RULES.chickenX + 15); advance(game, .3);
  assert.equal(game.hearts, 2); assert.equal(game.score, 0);
  advance(game, 1); assert.equal(game.invincible, 0);
  obstacle(game, 'bone', RULES.chickenX + 15); advance(game, .03); assert.equal(game.hearts, 1);
});

test('exhausting three hearts ends the run and prevents movement or jumps', () => {
  const game = running();
  for (let i = 0; i < 3; i++) { obstacle(game, 'bone', RULES.chickenX + 10); advance(game, 1.4); }
  assert.equal(game.hearts, 0); assert.equal(game.phase, 'gameover');
  const distance = game.distance; advance(game, 2); assert.equal(game.distance, distance); assert.equal(game.jump(), false);
});

test('speed increases continuously with score and caps at 500', () => {
  assert.equal(speedForScore(0), 260); assert.equal(speedForScore(100), 340);
  assert.ok(Math.abs(speedForScore(299) - 499.2) < 1e-9); assert.equal(speedForScore(300), 500); assert.equal(speedForScore(1000), 500);
});

test('pipes appear on random lanes at variable intervals and never crowd a row', () => {
  const game = running();
  let seed = 429;
  game.random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 300; i++) game.spawn();
  const pipes = game.obstacles.filter((o) => o.kind === 'pipe');
  assert.ok(pipes.length > 10);
  assert.equal(new Set(pipes.map((o) => o.lane)).size, 3);
  let count = 0;
  const intervals = new Set();
  for (const value of game.obstacles) {
    if (value.kind !== 'pipe') { count++; continue; }
    assert.ok(count >= 14 && count <= 24);
    intervals.add(count); count = 0;
    assert.equal(game.obstacles.filter((o) => o.row === value.row).length, 1);
  }
  assert.ok(intervals.size > 1);
});

for (const score of [0, 300]) {
  test(`pipes connect the two worlds at score ${score}, while ordinary ocean jumps stay underwater`, () => {
    const game = running(); game.score = score; game.hearts = 2;
    // Foot reaches the pipe rim at approximately 0.70 seconds on descent.
    const pipe = obstacle(game, 'pipe', RULES.chickenX + game.speed * .70 - 50);
    const next = obstacle(game, 'bone', pipe.x + 500);
    game.jump(); advance(game, .78);
    assert.equal(game.world, 'ocean'); assert.equal(game.hearts, 2); assert.equal(game.score, score);
    assert.ok(!game.obstacles.includes(pipe));
    game.spawnIn = 100;
    const frozenDistance = game.grassTrack.distance; const frozenX = next.x;
    advance(game, 4); assert.equal(game.world, 'ocean'); assert.equal(game.grassTrack.distance, frozenDistance); assert.equal(next.x, frozenX);
    assert.equal(game.jump(), true); assert.equal(game.jump(), false); advance(game, .9);
    assert.equal(game.world, 'ocean'); assert.equal(game.grounded, true);
    obstacle(game, 'pipe', RULES.chickenX + game.speed * (.7 / RULES.oceanJumpSpeed) - 50);
    game.jump(); advance(game, .72 / RULES.oceanJumpSpeed);
    assert.equal(game.world, 'grass'); assert.equal(game.score, score); assert.equal(game.hearts, 2); assert.equal(game.grounded, true);
    assert.ok(next.x >= RULES.chickenX + 18 + game.speed * (RULES.returnSafety - .03));
  });
}

test('hitting the pipe from the side damages the chicken instead of teleporting', () => {
  const game = running(); obstacle(game, 'pipe', RULES.chickenX + 10); advance(game, .3);
  assert.equal(game.world, 'grass'); assert.equal(game.hearts, 2); assert.equal(game.score, 0);
});

test('pausing freezes physics and resumes without a time jump, including underwater', () => {
  const game = running(); game.jump(); advance(game, .2); game.pause();
  const snapshot = JSON.stringify({ distance: game.distance, player: game.player, time: game.time });
  advance(game, 3); assert.equal(JSON.stringify({ distance: game.distance, player: game.player, time: game.time }), snapshot);
  assert.equal(game.jump(), false); game.resume(); advance(game, .1); assert.ok(game.time < .31);
  game.enterOcean(game.createObstacle('pipe')); game.spawnIn = 100; game.jump(); advance(game, .2); game.pause();
  const oceanTime = game.oceanTime; const y = game.player.y;
  advance(game, 3); assert.equal(game.world, 'ocean'); assert.equal(game.oceanTime, oceanTime); assert.equal(game.player.y, y);
  game.resume(); advance(game, .7); assert.equal(game.world, 'ocean'); assert.equal(game.grounded, true);
});

test('a collision during invincibility disqualifies an otherwise cleared obstacle', () => {
  const game = running(); game.invincible = 1; const bone = obstacle(game, 'bone', RULES.chickenX);
  bone.cleared = true; advance(game, .5); assert.equal(game.hearts, 3); assert.equal(game.score, 0);
});

test('winning at 1000 freezes the game and never exceeds the target', () => {
  const game = running(); game.score = 999;
  obstacle(game, 'bone', RULES.chickenX + game.speed * .38);
  game.jump(); advance(game, 1);
  assert.equal(game.score, 1000); assert.equal(game.phase, 'won');
  const distance = game.distance; advance(game, 3); assert.equal(game.distance, distance); assert.equal(game.jump(), false);
  assert.equal(game.drainEvents().filter((e) => e.type === 'win').length, 1);
});

test('a full generated 1000-point course remains jumpable as speed increases', () => {
  let seed = 431;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const game = new Game(random); game.start();
  for (let frame = 0; frame < 240000 && game.phase === 'running'; frame++) {
    const upcoming = game.obstacles.find((value) => !value.passed && value.x + value.width >= RULES.chickenX - 18);
    if (upcoming && game.grounded && upcoming.x <= RULES.chickenX + game.speed * (upcoming.kind === 'pipe' ? .22 : .38)) game.jump();
    game.update(1 / 120);
    game.drainEvents();
  }
  assert.equal(game.phase, 'won'); assert.equal(game.score, 1000); assert.equal(game.hearts, 3);
});

test('ocean mostly spawns bottles and black/clear bags; both nets combined occur about 1–2 times per 100', () => {
  const game = underwater();
  let seed = 719;
  game.random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 10000; i++) game.spawn();
  const ordinary = game.obstacles.filter((o) => o.kind !== 'pipe');
  const nets = ordinary.filter((o) => o.kind === 'oldnet' || o.kind === 'fallingnet');
  assert.ok(nets.length / ordinary.length >= .01 && nets.length / ordinary.length <= .02);
  for (const kind of ['bottle', 'blackbag', 'clearbag', 'oldnet', 'fallingnet', 'pipe']) assert.ok(game.obstacles.some((o) => o.kind === kind));
});

test('landing on an old net loses one heart, sticks briefly, and cannot score or jump while caught', () => {
  const game = underwater(); const net = obstacle(game, 'oldnet', RULES.chickenX + game.speed * (.78 / RULES.oceanJumpSpeed) - 33);
  game.jump(); advance(game, .82 / RULES.oceanJumpSpeed);
  assert.equal(game.hearts, 2); assert.equal(net.hit, true); assert.ok(game.player.stuckRemaining > 0);
  assert.equal(game.jump(), false); assert.equal(game.score, 0);
  const distance = game.distance; advance(game, .3); assert.equal(game.distance, distance); assert.equal(game.hearts, 2);
  advance(game, .5); assert.equal(game.player.stuckRemaining, 0); assert.equal(game.grounded, true);
  assert.equal(game.hearts, 2); assert.equal(game.score, 0); assert.equal(game.jump(), true);
});

test('falling net contact sticks and damages once, while invincibility protects against another net', () => {
  const game = underwater(); const net = obstacle(game, 'fallingnet', RULES.chickenX + 10);
  net.stage = 'landed'; net.bottom = RULES.ground;
  advance(game, .03); assert.equal(game.hearts, 2); assert.ok(game.player.stuckRemaining > 0);
  advance(game, .75); assert.equal(game.hearts, 2); assert.equal(game.score, 0);
  obstacle(game, 'oldnet', RULES.chickenX + 10); advance(game, .03);
  assert.equal(game.hearts, 2); assert.equal(game.player.stuckRemaining, 0);
});

test('higher scores shorten warning time but never remove the minimum warning', () => {
  assert.equal(netWarningForScore(0), 1.7);
  assert.ok(netWarningForScore(300) < netWarningForScore(0));
  assert.ok(netWarningForScore(600) < netWarningForScore(300));
  assert.equal(netWarningForScore(1000), RULES.netWarningMin);
  const low = underwater(); const high = underwater(); high.score = 900;
  const slowNet = obstacle(low, 'fallingnet', RULES.netDropX);
  const fastNet = obstacle(high, 'fallingnet', RULES.netDropX);
  advance(low, 1.1); advance(high, 1.1);
  assert.equal(slowNet.stage, 'warning'); assert.equal(fastNet.stage, 'falling');
});

for (const score of [0, 300, 900]) {
  test(`falling nets at score ${score} warn visibly, land ahead, and reserve reaction distance`, () => {
    const game = underwater(); game.score = score;
    const net = obstacle(game, 'fallingnet', RULES.netDropX);
    assert.ok(net.x >= 0 && net.x + net.width <= RULES.width);
    const x = net.x;
    advance(game, net.warningDuration - .02);
    assert.equal(net.stage, 'warning'); assert.equal(net.x, x); assert.equal(game.hearts, 3);
    advance(game, .04); assert.equal(net.stage, 'falling'); assert.equal(net.x, x);
    advance(game, RULES.netFallDuration);
    assert.equal(net.stage, 'landed'); assert.equal(net.bottom, RULES.ground);
    assert.ok((net.x - RULES.chickenX - 18) / game.speed >= 1);
  });
}

for (const score of [0, 300]) {
  for (const kind of ['oldnet', 'fallingnet']) {
    test(`ocean ${kind} can be cleared at score ${score} for exactly one point`, () => {
      const game = underwater(); game.score = score;
      const net = obstacle(game, kind, RULES.chickenX + game.speed * (kind === 'fallingnet' ? .17 : .22));
      if (kind === 'fallingnet') { net.stage = 'landed'; net.bottom = RULES.ground; }
      game.jump(); advance(game, .9);
      assert.equal(game.score, score + 1); assert.equal(game.hearts, 3); assert.equal(game.world, 'ocean');
      advance(game, 1); assert.equal(game.score, score + 1);
    });
  }
}

test('pause freezes both entanglement and falling-net warning timers', () => {
  const game = underwater(); obstacle(game, 'oldnet', RULES.chickenX + 10);
  const net = obstacle(game, 'fallingnet', RULES.netDropX);
  advance(game, .03); game.pause();
  const caught = game.player.stuckRemaining; const warning = net.warningRemaining;
  advance(game, 4); assert.equal(game.player.stuckRemaining, caught); assert.equal(net.warningRemaining, warning);
  game.resume(); advance(game, .8); assert.equal(game.player.stuckRemaining, 0); assert.equal(game.hearts, 2);
});

test('returning to grass clears ocean nets and capture state, and restart resets both worlds', () => {
  const game = underwater(); obstacle(game, 'oldnet', RULES.chickenX + 10); advance(game, .03);
  assert.ok(game.player.stuckRemaining > 0); game.returnToGrass();
  assert.equal(game.world, 'grass'); assert.equal(game.player.stuckRemaining, 0); assert.equal(game.caughtNet, null);
  assert.ok(game.obstacles.every((value) => value.kind !== 'oldnet'));
  game.start(); assert.equal(game.grassTrack, null); assert.equal(game.hearts, 3); assert.equal(game.score, 0);
});

test('a full generated course reaches 1000 points while using ocean return pipes and reentering from grass', () => {
  let seed = 793;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const game = new Game(random); game.start(); game.enterOcean(game.createObstacle('pipe'));
  let oceanEntries = 1; let grassReturns = 0;
  for (let frame = 0; frame < 420000 && game.phase === 'running'; frame++) {
    const ahead = game.obstacles.filter((value) => !value.passed && value.x + value.width >= RULES.chickenX - 18).sort((a, b) => a.x - b.x);
    const pipe = ahead.find((value) => value.kind === 'pipe');
    if (pipe && pipe.x - RULES.chickenX < game.speed * 2 && pipe.lane !== game.player.lane) game.moveLane(Math.sign(pipe.lane - game.player.lane));
    const upcoming = ahead.find((value) => value.lane === game.player.lane);
    const timing = upcoming?.kind === 'pipe' ? .7 / game.jumpSpeedFactor : game.world === 'ocean' ? upcoming?.kind === 'fallingnet' ? .17 : .22 : .38;
    const targetX = RULES.chickenX + game.speed * timing - (upcoming?.kind === 'pipe' ? 50 : 0);
    if (upcoming && game.grounded && upcoming.x <= targetX) game.jump();
    game.update(1 / 120);
    for (const event of game.drainEvents()) {
      if (event.type === 'ocean-enter') oceanEntries++;
      if (event.type === 'ocean-exit') grassReturns++;
    }
  }
  assert.equal(game.phase, 'won'); assert.equal(game.score, 1000); assert.equal(game.hearts, 3);
  assert.ok(oceanEntries > 1); assert.ok(grassReturns > 1);
});

test('lane input moves one slot, clamps at the edges, and interpolates through the real collision position', () => {
  const game = running();
  assert.equal(game.player.lane, 1);
  assert.equal(game.moveLane(-1), true); assert.equal(game.player.lane, 0);
  assert.equal(game.moveLane(-1), false);
  advance(game, RULES.laneSwitchTime / 2);
  assert.ok(Math.abs(game.player.lanePosition - .5) < .01);
  advance(game, RULES.laneSwitchTime / 2);
  assert.ok(Math.abs(game.player.lanePosition) < .01);
  assert.equal(game.moveLane(1), true); assert.equal(game.player.lane, 1);
  assert.equal(game.moveLane(1), true); assert.equal(game.player.lane, 2);
  assert.equal(game.moveLane(1), false);
  advance(game, RULES.laneSwitchTime * 2);
  assert.equal(game.player.lanePosition, 2);
  assert.equal(game.moveLane(0), false);
  game.pause(); assert.equal(game.moveLane(-1), false);
  game.resume(); game.player.stuckRemaining = .5; assert.equal(game.moveLane(-1), false);
  game.start(); assert.equal(game.player.lane, 1); assert.equal(game.player.lanePosition, 1);
});

test('obstacles in other lanes cannot damage or catch the chicken, and dodges score once', () => {
  const game = underwater();
  for (const [kind, lane] of [['oldnet', 0], ['blackbag', 2]]) {
    game.obstacles.push(game.createObstacle(kind, RULES.chickenX + 10, lane));
  }
  advance(game, 1);
  assert.equal(game.hearts, 3); assert.equal(game.player.stuckRemaining, 0); assert.equal(game.score, 2);
  advance(game, 1); assert.equal(game.score, 2);
});

test('starting a lane switch cannot instantly escape an obstacle at the current position', () => {
  const game = running(); obstacle(game, 'bone', RULES.chickenX + 8);
  game.moveLane(-1); advance(game, 1 / 120);
  assert.equal(game.player.lane, 0); assert.ok(game.player.lanePosition > .9);
  assert.equal(game.hearts, 2);
});

test('a pipe only teleports when landing in the same lane, including after a switch', () => {
  const game = running();
  game.obstacles.push(game.createObstacle('pipe', RULES.chickenX + game.speed * .70 - 50, 0));
  game.jump(); advance(game, .78); assert.equal(game.world, 'grass'); assert.equal(game.hearts, 3);
  const switched = running();
  switched.obstacles.push(switched.createObstacle('pipe', RULES.chickenX + switched.speed * .70 - 50, 0));
  switched.moveLane(-1); switched.jump(); advance(switched, .78);
  assert.equal(switched.world, 'ocean'); assert.equal(switched.player.lane, 0); assert.equal(switched.hearts, 3);
});

test('rows randomly contain zero, one, two or three obstacles, with no duplicate occupied lanes', () => {
  for (const sample of [.1, .3, .6, .9]) {
    const game = running();
    game.random = () => sample;
    game.spawn();
    assert.equal(game.obstacles.length, Math.floor(sample * 4));
    assert.equal(new Set(game.obstacles.map((o) => o.lane)).size, game.obstacles.length);
    assert.ok(game.obstacles.every((o) => o.x === RULES.spawnX));
    assert.ok(game.spawnIn >= 1.35);
  }
});

for (const kind of ['bottle', 'blackbag', 'clearbag']) {
  test(`${kind} can be jumped, collided with, or dodged underwater`, () => {
    const jumped = underwater(); obstacle(jumped, kind, RULES.chickenX + jumped.speed * .22);
    jumped.jump(); advance(jumped, 1); assert.equal(jumped.hearts, 3); assert.equal(jumped.score, 1);
    const hit = underwater(); obstacle(hit, kind, RULES.chickenX + 10);
    advance(hit, 1); assert.equal(hit.hearts, 2); assert.equal(hit.score, 0); assert.equal(hit.player.stuckRemaining, 0);
    const dodged = underwater(); obstacle(dodged, kind, RULES.chickenX + dodged.speed * .8);
    dodged.moveLane(1); advance(dodged, 1.3); assert.equal(dodged.hearts, 3); assert.equal(dodged.score, 1);
  });
}

test('three occupied lanes remain jumpable at maximum speed in both worlds', () => {
  for (const world of ['grass', 'ocean']) {
    const game = world === 'grass' ? running() : underwater(); game.score = 800;
    const kinds = world === 'grass' ? ['bone', 'applecore', 'can'] : ['bottle', 'blackbag', 'clearbag'];
    kinds.forEach((kind, lane) => game.obstacles.push(game.createObstacle(kind, RULES.chickenX + game.speed * (world === 'grass' ? .38 : .22), lane)));
    game.jump(); advance(game, 1);
    assert.equal(game.hearts, 3); assert.equal(game.score, 803);
  }
});

test('falling net warnings hold the whole row, and pause freezes lane changes', () => {
  const game = underwater();
  const net = game.createObstacle('fallingnet', RULES.spawnX, 0), bag = game.createObstacle('blackbag', RULES.spawnX, 1);
  net.row = bag.row = 123; game.obstacles.push(net, bag);
  advance(game, .5); assert.equal(bag.x, RULES.spawnX); assert.equal(net.x, RULES.spawnX);
  game.moveLane(1); advance(game, .05); game.pause();
  const position = game.player.lanePosition; advance(game, 1); assert.equal(game.player.lanePosition, position);
  game.resume(); advance(game, 2.5); assert.ok(bag.x < RULES.spawnX); assert.ok(Math.abs(bag.x - net.x) < .01);
});
