/** Convert a pointer offset into a radial analog value and clamped thumb pixels. */
export function joystickVector(dx, dy, radius, deadzone = 0.12) {
  dx = Number.isFinite(dx) ? dx : 0;
  dy = Number.isFinite(dy) ? dy : 0;
  if (!Number.isFinite(radius) || radius <= 0) {
    return {x: 0, y: 0, thumbX: 0, thumbY: 0, magnitude: 0};
  }
  deadzone = Number.isFinite(deadzone) ? Math.max(0, Math.min(1, deadzone)) : 0.12;
  const distance = Math.hypot(dx, dy);
  if (!distance) return {x: 0, y: 0, thumbX: 0, thumbY: 0, magnitude: 0};
  const radial = Math.min(1, distance / radius);
  const magnitude = radial > deadzone ? (radial - deadzone) / (1 - deadzone) : 0;
  const unitX = dx / distance, unitY = dy / distance;
  const thumbDistance = Math.min(distance, radius);
  return {
    x: magnitude ? unitX * magnitude : 0,
    y: magnitude ? unitY * magnitude : 0,
    thumbX: unitX ? unitX * thumbDistance : 0,
    thumbY: unitY ? unitY * thumbDistance : 0,
    magnitude,
  };
}

/** Return a unit movement direction and its separate analog speed (0..1).
 * keys is a Set of KeyboardEvent.code values; joystick x is right and y is down.
 */
export function movementAxes(keys, joystick) {
  const pressed = code => typeof keys?.has === 'function' && keys.has(code);
  let forward = Number(pressed('KeyW') || pressed('ArrowUp'))
    - Number(pressed('KeyS') || pressed('ArrowDown'));
  let strafe = Number(pressed('KeyD') || pressed('ArrowRight'))
    - Number(pressed('KeyA') || pressed('ArrowLeft'));
  if (Number.isFinite(joystick?.x)) strafe += joystick.x;
  if (Number.isFinite(joystick?.y)) forward -= joystick.y;
  const length = Math.hypot(forward, strafe);
  if (!length) return {forward: 0, strafe: 0, magnitude: 0};
  return {forward: forward / length, strafe: strafe / length, magnitude: Math.min(1, length)};
}

/** Require the standard API and an explicit browser permission signal. */
export function nativeFullscreenAvailable(doc) {
  return doc?.fullscreenEnabled === true
    && typeof doc.documentElement?.requestFullscreen === 'function'
    && typeof doc.exitFullscreen === 'function';
}

export function standaloneMode(nav, matchMediaFn) {
  if (nav?.standalone) return true;
  if (typeof matchMediaFn !== 'function') return false;
  try { return matchMediaFn('(display-mode: standalone)')?.matches === true; }
  catch { return false; }
}

/** Spark can have uploads ready even after its pager reports no queued work. */
export function hasPendingDetail(spark) {
  if (!spark) return false;
  if (spark.sorting || spark.sortDirty) return true;
  const pager = spark.pager;
  if (!pager) return false;
  for (const method of ['isPending', 'isFetching', 'hasQueued']) {
    if (typeof pager[method] === 'function' && pager[method]()) return true;
  }
  return Boolean(pager.readyUploads?.length || pager.newUploads?.length);
}

/** Observe pending detail without requesting frames, fetching, or rendering.
 * Creation is idle. notify/resume sample immediately; pending work and the quiet
 * tail are the only states that schedule timers. stop is permanent.
 */
export function createDetailMonitor({
  isPending,
  onChange = () => {},
  now = () => performance.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  quietMs = 750,
  pollMs = 250,
}) {
  quietMs = Number.isFinite(quietMs) ? Math.max(0, quietMs) : 750;
  pollMs = Number.isFinite(pollMs) ? Math.max(1, pollMs) : 250;
  let visible = false, paused = false, stopped = false;
  let timer = null, quietSince = null;
  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const change = next => {
    if (visible === next) return;
    visible = next;
    onChange(next);
  };
  const arm = delay => {
    if (stopped || paused || timer !== null) return;
    timer = schedule(() => { timer = null; sample(); }, delay);
  };
  const sample = () => {
    if (stopped || paused) return;
    clearTimer();
    if (isPending()) {
      quietSince = null;
      change(true);
      arm(pollMs);
      return;
    }
    if (!visible) { quietSince = null; return; }
    const time = now();
    if (quietSince === null) quietSince = time;
    const remaining = quietMs - (time - quietSince);
    if (remaining <= 0) {
      quietSince = null;
      change(false);
    } else arm(Math.min(pollMs, remaining));
  };
  return {
    get visible() { return visible; },
    notify: sample,
    pause() {
      if (stopped) return;
      paused = true;
      clearTimer();
      quietSince = null;
      change(false);
    },
    resume() {
      if (stopped) return;
      paused = false;
      sample();
    },
    stop() {
      stopped = true;
      paused = true;
      clearTimer();
      quietSince = null;
      change(false);
    },
  };
}