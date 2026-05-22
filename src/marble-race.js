// Multi-marble race built on matter.js
// Each menu item is a separate ball that drops from the top, bounces off
// pegs and tilted bars, and lands in a slot at the bottom. The first
// marble to hit the floor wins.

const ARENA_WIDTH = 320;
const ARENA_HEIGHT = 540;
const SLOT_HEIGHT = 34;
const BALL_RADIUS = 10;

export function startMarbleRace({ canvas, items, slotColors, onFinish }) {
  const Matter = window.Matter;
  if (!Matter) {
    console.error("matter.js is not loaded");
    onFinish?.(0);
    return () => {};
  }
  const { Engine, Render, Runner, World, Bodies, Events } = Matter;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = ARENA_WIDTH * dpr;
  canvas.height = ARENA_HEIGHT * dpr;
  canvas.style.width = `${ARENA_WIDTH}px`;
  canvas.style.height = `${ARENA_HEIGHT}px`;

  const engine = Engine.create();
  engine.world.gravity.y = 1.2;

  const slotWidth = ARENA_WIDTH / items.length;
  const floorY = ARENA_HEIGHT - SLOT_HEIGHT;

  // === Walls ===
  const wallT = 24;
  const walls = [
    Bodies.rectangle(-wallT / 2, ARENA_HEIGHT / 2, wallT, ARENA_HEIGHT, {
      isStatic: true,
      render: { fillStyle: "#1e293b" },
    }),
    Bodies.rectangle(ARENA_WIDTH + wallT / 2, ARENA_HEIGHT / 2, wallT, ARENA_HEIGHT, {
      isStatic: true,
      render: { fillStyle: "#1e293b" },
    }),
  ];

  // === Slot dividers + floor ===
  const slotElems = [];
  for (let i = 1; i < items.length; i += 1) {
    const x = i * slotWidth;
    slotElems.push(
      Bodies.rectangle(x, floorY + SLOT_HEIGHT / 2, 2, SLOT_HEIGHT, {
        isStatic: true,
        render: { fillStyle: "#334155" },
      }),
    );
  }
  // Finish floor (detection layer) — slightly above ground so winner is set as soon as a marble lands in a slot
  const floor = Bodies.rectangle(ARENA_WIDTH / 2, floorY + SLOT_HEIGHT - 5, ARENA_WIDTH, 10, {
    isStatic: true,
    label: "floor",
    render: { fillStyle: "#0b1424" },
  });

  // === Obstacles ===
  const obstacles = [];

  // Staggered peg grid
  const pegRows = 6;
  const pegsPerRow = 7;
  for (let row = 0; row < pegRows; row += 1) {
    const y = 90 + row * 50;
    const offset = row % 2 === 0 ? 0 : ARENA_WIDTH / (pegsPerRow * 2);
    for (let col = 0; col < pegsPerRow; col += 1) {
      const x = offset + (col + 0.5) * (ARENA_WIDTH / pegsPerRow);
      if (x < 12 || x > ARENA_WIDTH - 12) continue;
      obstacles.push(
        Bodies.circle(x, y, 5, {
          isStatic: true,
          restitution: 0.7,
          render: { fillStyle: "#cbd5e1" },
        }),
      );
    }
  }

  // Tilted bars
  const bars = [
    { x: ARENA_WIDTH * 0.25, y: 170, w: 64, angle: 0.32 },
    { x: ARENA_WIDTH * 0.75, y: 200, w: 64, angle: -0.32 },
    { x: ARENA_WIDTH * 0.5, y: 280, w: 80, angle: 0.18 },
    { x: ARENA_WIDTH * 0.2, y: 360, w: 60, angle: -0.34 },
    { x: ARENA_WIDTH * 0.8, y: 390, w: 60, angle: 0.34 },
    { x: ARENA_WIDTH * 0.5, y: 430, w: 70, angle: -0.16 },
  ];
  for (const b of bars) {
    obstacles.push(
      Bodies.rectangle(b.x, b.y, b.w, 8, {
        isStatic: true,
        angle: b.angle,
        restitution: 0.6,
        render: { fillStyle: "#f59e0b" },
      }),
    );
  }

  // === Marbles (balls) ===
  const marbles = items.map((item, i) => {
    // Distribute balls across the top with a small jitter
    const x = (i + 0.5) * (ARENA_WIDTH / items.length) + (((i * 7919) % 17) - 8);
    const y = 24 + ((i * 11) % 14);
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.65,
      friction: 0.02,
      frictionAir: 0.005,
      density: 0.002,
      label: `marble-${i}`,
      render: { fillStyle: slotColors[i] || "#f8fafc" },
    });
    ball.itemIndex = i;
    ball.itemLabel = item.label;
    return ball;
  });

  World.add(engine.world, [...walls, ...slotElems, floor, ...obstacles, ...marbles]);

  // === Renderer ===
  const render = Render.create({
    canvas,
    engine,
    options: {
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      wireframes: false,
      background: "transparent",
      pixelRatio: dpr,
    },
  });

  // Custom overlay: slot labels + marble labels
  Events.on(render, "afterRender", () => {
    const ctx = render.context;
    ctx.save();
    // Slot labels
    ctx.font = 'bold 11px "Inter", "Pretendard", -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < items.length; i += 1) {
      const x = (i + 0.5) * slotWidth;
      const item = items[i];
      ctx.fillStyle = item.type === "menu" ? "#ecfeff" : item.type === "again" ? "#fef3c7" : "#fda4af";
      const maxChars = Math.max(3, Math.floor(slotWidth / 7));
      const text = item.label.length > maxChars ? `${item.label.slice(0, maxChars)}` : item.label;
      ctx.fillText(text, x, floorY + SLOT_HEIGHT / 2);
    }
    // Marble labels (small)
    ctx.font = 'bold 9.5px "Inter", "Pretendard", sans-serif';
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    for (const marble of marbles) {
      const { x, y } = marble.position;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.92)";
      ctx.fillStyle = "#ffffff";
      const label = marble.itemLabel.length > 3 ? marble.itemLabel.slice(0, 3) : marble.itemLabel;
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
    }
    ctx.restore();
  });

  Render.run(render);

  // === Runner ===
  const runner = Runner.create();
  Runner.run(runner, engine);

  // === Winner detection ===
  let winnerIndex = null;
  let cleanedUp = false;
  let finishTimer = null;

  Events.on(engine, "collisionStart", (event) => {
    if (winnerIndex !== null) return;
    for (const pair of event.pairs) {
      const isFloorHit = pair.bodyA.label === "floor" || pair.bodyB.label === "floor";
      if (!isFloorHit) continue;
      const marble = pair.bodyA.label === "floor" ? pair.bodyB : pair.bodyA;
      if (marble.itemIndex === undefined) continue;
      winnerIndex = marble.itemIndex;
      // Linger briefly so the user can see the winning ball settle, then stop.
      finishTimer = setTimeout(() => {
        if (cleanedUp) return;
        try {
          Render.stop(render);
          Runner.stop(runner);
        } catch {}
        onFinish?.(winnerIndex);
      }, 600);
      return;
    }
  });

  // === Safety timeout: if no marble finishes within 12s, pick the lowest ball
  const safetyTimer = setTimeout(() => {
    if (winnerIndex !== null || cleanedUp) return;
    let lowest = marbles[0];
    for (const m of marbles) {
      if (m.position.y > lowest.position.y) lowest = m;
    }
    winnerIndex = lowest.itemIndex;
    try {
      Render.stop(render);
      Runner.stop(runner);
    } catch {}
    onFinish?.(winnerIndex);
  }, 12000);

  // Cleanup
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (finishTimer) clearTimeout(finishTimer);
    if (safetyTimer) clearTimeout(safetyTimer);
    try {
      Render.stop(render);
      Runner.stop(runner);
      World.clear(engine.world);
      Engine.clear(engine);
    } catch {}
  };
}
