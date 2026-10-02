import { createDialEditor } from "./manzanilla-editor.js";
import { annulus, arcLayout, DESIGN, polar, roundedSector, sector } from "./manzanilla-geometry.mjs";
import { inwardQuadrant } from "./manzanilla-layout.mjs";
import {
  DIAL_EASING,
  dialMotion,
  MECHANICAL_SETTLE_MS,
  mechanicalTarget,
  preciseRotation,
} from "./manzanilla-motion.mjs";
import { createPreciseSound } from "./manzanilla-precise-sound.js";
import { DIAL_THEMES, isDialTheme } from "./manzanilla-themes.mjs";
import { dialModes, modes, turn } from "./manzanilla-wheel.mjs";

const NS = "http://www.w3.org/2000/svg",
  bands = document.querySelector("#bands"),
  scene = document.querySelector("#scene"),
  detail = document.querySelector("#detail");
const icons = {
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  tasks: "M9 4H5v18h14V4h-4M9 2h6v4H9ZM8 11h8M8 16h8",
  desk: "M3 3h18v14H3ZM8 22h8M12 17v5",
  plus: "M12 4v16M4 12h16",
  loop: "M4 8a8 8 0 0 1 14-3l3 3M21 2v6h-6M20 16A8 8 0 0 1 6 19l-3-3M3 22v-6h6",
  talk: "M21 11a9 9 0 0 1-9 9H4l-3 2 1-7a9 9 0 1 1 19-4",
  activity: "M3 3v18h18M6 15l5-6 4 3 6-8",
  person: "M20 22v-2a8 8 0 0 0-16 0v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
};
icons.link = "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2";
icons.phone = "M6 2h12v20H6ZM9 5h6M10 18h4";
icons.palette =
  "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-4-6-9-6ZM7 9h.01M10 6h.01M15 6h.01";
let team = [],
  connected = false,
  selected = 3,
  expanded = false,
  employee = 0,
  page = 0,
  sound = true,
  voice = { state: "idle" },
  held = false;
let voiceTargets = [],
  voiceTarget = "",
  rotationAnimation = null,
  entryAnimation = null,
  visible = false;
let branch = "team",
  controlPage = "",
  teamPage = false,
  preferences = { volume: 0.38, glow: "normal", motion: "full", theme: "liquid" };
const ringRows = new Map(),
  ringOffsets = [0, 0, 0],
  ringAngles = [0, 0, 0],
  preciseSound = createPreciseSound();
let pointer = null;
const mechanicalInputs = [0, 0, 0],
  mechanicalFrames = [0, 0, 0];
function resetMechanical() {
  mechanicalInputs.fill(0);
  mechanicalFrames.forEach(cancelAnimationFrame);
  mechanicalFrames.fill(0);
}
window.arc.on("hold", (v) => {
  if (v) resetMechanical();
});
function mechanicalMove(node, depth, delta) {
  mechanicalInputs[depth] = preciseRotation(mechanicalInputs[depth], delta);
  const target = mechanicalTarget(mechanicalInputs[depth]);
  if (Number(node.dataset.mechanicalTarget || 0) === target) return;
  node.dataset.mechanicalTarget = target;
  cancelAnimationFrame(mechanicalFrames[depth]);
  const from = ringAngles[depth],
    start = performance.now();
  if (sound) preciseSound.move(delta, preferences.volume);
  function frame(now) {
    if (!node.isConnected) return;
    const t = Math.min(1, (now - start) / MECHANICAL_SETTLE_MS),
      ease = t * t * (3 - 2 * t);
    ringAngles[depth] = from + (target - from) * ease;
    applyPreciseAngle(node, depth);
    mechanicalFrames[depth] = t < 1 ? requestAnimationFrame(frame) : 0;
  }
  mechanicalFrames[depth] = requestAnimationFrame(frame);
}
document.addEventListener(
  "pointermove",
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  pointer = null;
});
const editor = createDialEditor({
  onStart() {
    action("edit-start");
    voice = { state: "idle" };
    expanded = false;
    entryAnimation?.cancel();
    entryAnimation = null;
    rotationAnimation?.cancel();
    rotationAnimation = null;
    render();
  },
  onPreview(layout) {
    const l = arcLayout(innerWidth, innerHeight, 1, layout);
    scene.setAttribute("transform", `translate(${l.offset},${l.top}) scale(${l.scale})`);
  },
  onFinish(save, layout) {
    if (save) preferences.layout = layout;
    action("edit-finish", { save, layout });
    render();
  },
});
function savePreference(key, value) {
  preferences[key] = value;
  if (key === "motion") {
    resetMechanical();
    ringAngles.fill(0);
    preciseSound.stop();
  }
  action("preferences", { key, value });
  applyPreferences();
  render(false, 0, key !== "theme" && key !== "motion");
}
function applyPreferences() {
  for (const a of detents) a.volume = preferences.volume;
  document.documentElement.dataset.glow = preferences.glow;
  document.documentElement.dataset.motion = preferences.motion;
  document.documentElement.dataset.theme = isDialTheme(preferences.theme) ? preferences.theme : "liquid";
}
function openControl(page = "") {
  if (controlPage !== page) ringOffsets[2] = 0;
  branch = "control";
  controlPage = page;
  setExpanded(true);
}
function controlItems() {
  if (controlPage === "Sound")
    return [
      {
        label: sound ? "Mute sounds" : "Enable sounds",
        icon: "mic",
        click: () => {
          sound = !sound;
          action("sound", sound);
          render(false, 0, true);
        },
      },
      ...[0.15, 0.38, 0.7].map((v, i) => ({
        label: ["Quiet", "Normal", "Loud"][i],
        icon: "activity",
        active: preferences.volume === v,
        click: () => savePreference("volume", v),
      })),
    ];
  if (controlPage === "Appearance")
    return DIAL_THEMES.map((t) => ({
      label: t.name,
      icon: "palette",
      active: preferences.theme === t.id,
      click: () => savePreference("theme", t.id),
    }));
  if (controlPage === "Motion")
    return ["full", "calm", "precise", "mechanical", "reduced"].map((v) => ({
      label:
        v === "mechanical"
          ? "Mechanical motion"
          : v === "precise"
            ? "Precise motion"
            : v === "reduced"
              ? "Reduced motion"
              : v === "calm"
                ? "Calm motion"
                : "Full motion",
      icon: "loop",
      active: preferences.motion === v,
      click: () => savePreference("motion", v),
    }));

  return [{ label: "Choose a setting", icon: "desk", click: () => {} }];
}
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
function icon(key) {
  const s = el("svg", { viewBox: "0 0 24 24" });
  s.append(el("path", { d: icons[key] || icons.person }));
  return s;
}
const detents = Array.from({ length: 4 }, () => {
  const a = new Audio("sounds/orange_metal.wav");
  a.preload = "auto";
  a.volume = 0.38;
  return a;
});
let detentIndex = 0,
  lastCue = -Infinity;
function cue() {
  if (preferences.motion === "precise") return;
  const now = performance.now();
  if (sound && now - lastCue > 85) {
    lastCue = now;
    const a = detents[detentIndex++ % detents.length];
    a.currentTime = 0;
    void a.play().catch(() => {});
  }
}
function action(type, id) {
  window.arc.action({ type, id });
}
function setExpanded(value) {
  expanded = value;
  render(true, 0, true);
}
function applyPreciseAngle(group, index) {
  const angle = ringAngles[index];
  group.style.transform = `rotate(${angle}deg)`;
  // Counter-rotate each icon/label assembly around its own moving anchor.
  // The anchor travels with the wheel; the content remains level to the screen.
  for (const content of group.querySelectorAll(".item-content"))
    content.setAttribute("transform", `rotate(${-angle} ${content.dataset.pivotX} ${content.dataset.pivotY})`);
}
function row(inner, outer, items, index, animate, rotation = 0, previousAngle = 0) {
  const old = bands.querySelector(`[data-depth="${index}"]`);
  const signature = JSON.stringify([
    inner,
    outer,
    items.map((i) => [i.label, i.icon]),
    preferences.theme,
    preferences.motion,
    inwardQuadrant(editor.active ? editor.layout : preferences.layout),
    ringOffsets[index],
  ]);
  ringRows.set(index, { inner, outer, items });
  if (old && index > 0 && !rotation && old.dataset.signature === signature) {
    for (const p of old.querySelectorAll(".segment")) {
      const item = items.find((i) => i.label === p.getAttribute("aria-label"));
      p.classList.toggle("active", !!item?.active);
      p.parentElement.classList.toggle("chosen", !!item?.active);
    }
    return;
  }
  old?.remove();
  const group = el("g", {
    class: `ring${index === 0 ? " ring-primary" : ""}`,
    "data-depth": index,
    "data-signature": signature,
  });
  group.append(el("path", { d: annulus(inner, outer), "fill-rule": "evenodd", class: "dial-body" }));
  if (index === 0) bands.append(group);
  else bands.prepend(group);
  const slots = index === 0 ? 8 : items.length * Math.ceil(16 / items.length),
    width = 360 / slots;
  const vivid = ["#1762dc", "#40a142", "#ffd20a", "#ff8523", "#df3c42", "#7950be", "#68696d", "#18b2bb"];
  const pastel = ["#e6d8c9", "#b5cae8", "#b7d2b5", "#bdabd9", "#eeb199", "#dfaeb1", "#bfc0c4", "#f2d992"];
  // Child rings remain complete during the summon spin; blank sectors are not actions.
  const cells =
    index === 0
      ? items
      : Array.from(
          { length: slots },
          (_, i) => items[(((i + ringOffsets[index]) % items.length) + items.length) % items.length],
        );
  const quadrant = inwardQuadrant(editor.active ? editor.layout : preferences.layout);
  const continuous = ["porcelain", "graphite", "smoke"].includes(preferences.theme);
  cells.forEach((item, i) => {
    const gap = continuous ? 0 : 0.7,
      start = (index === 0 ? quadrant - 67.5 : quadrant) + i * width + gap / 2,
      end = start + width - gap,
      mid = (start + end) / 2;
    const colorIndex = item?.colorIndex ?? i % 8,
      corner = continuous || preferences.theme === "vivid" ? 0 : preferences.theme === "clay" ? 12 : 7;
    const d = corner ? roundedSector(inner, outer, start, end, corner) : sector(inner, outer, start, end);
    const edgeId = `prism-${index}-${i}`,
      edge = el("linearGradient", { id: edgeId, x1: 0, y1: 0, x2: 1, y2: 1 });
    for (const [offset, color] of [
      [0, "#ffffff"],
      [0.22, pastel[colorIndex]],
      [0.48, "#7183a055"],
      [0.75, "#d1beff"],
      [1, "#fbd5a3"],
    ])
      edge.append(el("stop", { offset, "stop-color": color }));
    const cell = el("g", {
      class: `cell${item?.active ? " chosen" : ""}`,
      style: `--vivid:${vivid[colorIndex]};--pastel:${pastel[colorIndex]};--tint:${vivid[colorIndex]};--tint-soft:${vivid[colorIndex]}70;--prism-edge:url(#${edgeId})`,
    });
    cell.append(edge);
    const clipId = `dial-clip-${index}-${i}`,
      clip = el("clipPath", { id: clipId });
    clip.append(el("path", { d }));
    cell.append(clip);
    // Backlight precedes the glass, following the supplied material recipe.
    cell.append(el("path", { d, class: "cell-glow" }));
    const points = [polar(outer, start), polar(outer, end), polar(inner, start), polar(inner, end)];
    for (let a = Math.ceil(start / 90) * 90; a < end; a += 90) points.push(polar(outer, a), polar(inner, a));
    const x0 = Math.min(...points.map((p) => p[0])) - 2,
      y0 = Math.min(...points.map((p) => p[1])) - 2;
    const w = Math.max(...points.map((p) => p[0])) - x0 + 2,
      h = Math.max(...points.map((p) => p[1])) - y0 + 2;
    const materialClip = el("g", { "clip-path": `url(#${clipId})` }),
      material = el("foreignObject", { x: x0, y: y0, width: w, height: h, class: "material-host" }),
      surface = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    surface.className = "material";
    material.append(surface);
    materialClip.append(material);
    cell.append(materialClip);
    cell.append(
      el("path", { d, class: "cell-lip", "clip-path": `url(#${clipId})` }),
      el("path", { d, class: "cell-sheen" }),
    );
    const path = el("path", {
      d,
      class: `segment${item?.active ? " active" : ""}`,
      ...(item
        ? { role: "button", tabindex: 0, "aria-label": item.label }
        : { "aria-hidden": true, style: "pointer-events:none" }),
    });
    if (!item) {
      cell.append(path);
      group.append(cell);
      return;
    }
    // Commit on pointer-down: voice/status updates may replace the SVG before
    // mouse-up, otherwise Chromium never delivers the click to this element.
    const activate = () => {
      if (editor.active) return;
      action("browse");
      cue();
      (ringRows.get(index)?.items.find((i) => i.label === item.label) || item).click();
    };
    let hovered = false;
    path.addEventListener("pointermove", () => {
      if (hovered) return;
      hovered = true;
      cue();
    });
    path.addEventListener("pointerleave", () => {
      hovered = false;
    });
    let pointerCommitted = false;
    path.addEventListener("pointerdown", (e) => {
      if (e.button === 0) {
        pointerCommitted = true;
        e.preventDefault();
        activate();
      }
    });
    path.addEventListener("click", () => {
      if (!pointerCommitted) activate();
      pointerCommitted = false;
    });
    path.addEventListener("pointercancel", () => {
      pointerCommitted = false;
    });
    path.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    cell.append(path);
    const [x, y] = polar((inner + outer) / 2, mid),
      content = el("g", { class: "item-content", "data-pivot-x": x, "data-pivot-y": y, "pointer-events": "none" }),
      g = el("g", { class: "glyph", transform: `translate(${x - 12},${y - 24})` });
    g.append(el("path", { d: icons[item.icon] || icons.person }));
    content.append(g);
    if (item.icon === "phone")
      content.append(
        el("circle", { cx: x + 15, cy: y - 20, r: 3, class: `status-dot${connected ? " connected" : ""}` }),
      );
    const label = el("text", { x, y: y + 15, class: "label" }),
      caption =
        item.active && !expanded
          ? {
              listening: "Listening…",
              finishing: "Transcribing…",
              sending: "Sending…",
              sent: "Sent",
              error: "Voice unavailable",
            }[voice.state] || item.label
          : item.label;
    const words = caption.split(" "),
      lines = caption.length > 13 ? [words.slice(0, -1).join(" "), words.at(-1)] : [caption];
    lines.forEach((line, j) => {
      const span = el("tspan", { x, dy: j ? 13 : 0 });
      span.textContent = line;
      label.append(span);
    });
    content.append(label);
    cell.append(content);
    group.append(cell);
  });
  for (const r of [inner, outer]) {
    const circle = { cx: DESIGN.cx, cy: DESIGN.cy, r };
    group.append(el("circle", { ...circle, class: "rim rim-bloom" }), el("circle", { ...circle, class: "rim" }));
  }
  if (preferences.motion === "precise" || preferences.motion === "mechanical") applyPreciseAngle(group, index);
  if (animate && preferences.motion !== "reduced" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (index > 0 && !rotation && !old) {
      const parentOuter = arcLayout(innerWidth, innerHeight, true).rings[index - 1][1];
      group.classList.add("ring-revealing");
      const reveal = group.animate(
        [
          { opacity: 0, transform: `scale(${parentOuter / outer})` },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: dialMotion(preferences.motion).expand, easing: DIAL_EASING.out, fill: "backwards" },
      );
      reveal.finished.then(() => group.classList.remove("ring-revealing")).catch(() => {});
      return;
    }
    if (!rotation) return; // No idle animation on every hold/status render.
    const animation = group.animate(
      [
        { transform: `rotate(${previousAngle + (index > 0 ? rotation : -rotation) * width}deg)` },
        { transform: "rotate(0deg)" },
      ],
      { duration: dialMotion(preferences.motion).rotate, easing: DIAL_EASING.out },
    );
    if (index === 0) rotationAnimation = animation;
  }
}
function text(tag, cls, value) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = value;
  return n;
}
function button(label, fn, primary = false) {
  const b = text("button", primary ? "primary" : "", label);
  b.addEventListener("click", fn);
  return b;
}
function render(animate = false, rotation = 0, preservePrimary = false) {
  const previous = bands.querySelector(".ring-primary");
  const matrix = previous && rotation ? new DOMMatrixReadOnly(getComputedStyle(previous).transform) : null;
  const previousAngle = matrix ? (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI : 0;
  if (!preservePrimary) {
    rotationAnimation?.cancel();
    rotationAnimation = null;
  }
  const depth = expanded ? ((branch === "control" ? controlPage : teamPage) ? 3 : 2) : 1;
  window.arc.action({ type: "depth", depth });
  const l = arcLayout(innerWidth, innerHeight, depth, editor.active ? editor.layout : preferences.layout);
  scene.setAttribute("transform", `translate(${l.offset},${l.top}) scale(${l.scale})`);
  for (const child of [...bands.children]) if (Number(child.dataset.depth) >= depth) child.remove();
  if (!preservePrimary || !previous) {
    row(
      ...l.rings[0],
      dialModes(selected).map((index) => {
        const [label, key, target] = modes[index];
        return {
          label,
          icon: key,
          colorIndex: index,
          active: index === selected,
          click: () => {
            if (index === 0) {
              const close = expanded && branch === "team";
              branch = "team";
              teamPage = false;
              setExpanded(!close);
            } else if (index === 3) {
              if (expanded && branch === "control") setExpanded(false);
              else openControl();
            } else if (target === "themes") {
              openControl("Appearance");
            } else {
              selected = index;
              action(target);
            }
          },
        };
      }),
      0,
      animate,
      rotation,
      previousAngle,
    );
  }
  for (const path of bands.querySelectorAll(".ring-primary .segment")) {
    const active = path.getAttribute("aria-label") === modes[expanded ? (branch === "control" ? 3 : 0) : selected][0];
    path.classList.toggle("active", active);
    path.parentElement.classList.toggle("chosen", active);
  }
  if (expanded && branch === "control") {
    row(
      ...l.rings[1],
      ["Sound", "Appearance", "Motion"].map((name) => ({
        label: name,
        icon: name === "Orange" ? "phone" : name === "Appearance" ? "palette" : name === "Edit" ? "plus" : "desk",
        active: controlPage === name,
        click: () => (name === "Edit" ? editor.open(preferences.layout) : openControl(name)),
      })),
      1,
      animate,
    );
    if (controlPage) row(...l.rings[2], controlItems(), 2, animate);
  }
  if (expanded && branch === "team") {
    row(
      ...l.rings[1],
      [
        { label: "Open Dani", icon: "plus", click: () => action("overview") },
        { label: "Workspace", icon: "activity", click: () => action("overview") },
        {
          label: "Agents",
          icon: "loop",
          click: () => {
            teamPage = true;
            render(true, 0, true);
          },
        },
        {
          label: "Team",
          icon: "team",
          active: teamPage,
          click: () => {
            teamPage = !teamPage;
            render(true, 0, true);
          },
        },
      ],
      1,
      animate,
    );
    if (teamPage) {
      const items = team.slice(page * 4, page * 4 + 4).map((a, i) => ({
        label: a.name,
        icon: "person",
        sub: a.status,
        active: employee === page * 4 + i,
        click: () => action("employee", a.id),
      }));
      if (!items.length) items.push({ label: "Open Dani", icon: "plus", click: () => action("overview") });
      items.unshift({
        label: team.length > 4 ? "Next employees" : "Open workspace",
        icon: "loop",
        click: () => {
          if (team.length > 4) {
            page = (page + 1) % Math.ceil(team.length / 4);
            employee = page * 4;
            render(true);
          } else action("overview");
        },
      });
      row(...l.rings[2], items, 2, animate);
    }
  }
  detail.replaceChildren();
  detail.hidden = true;
  document.body.classList.toggle("listening", voice.state === "listening");
  document.body.dataset.voice = voice.state;
}
window.arc.on("team", (v) => {
  if (JSON.stringify(team) === JSON.stringify(v)) return;
  team = v;
  employee = Math.min(employee, Math.max(0, team.length - 1));
  if (expanded) render(false, 0, true);
});
window.arc.on("connection", (v) => {
  connected = v;
  for (const dot of bands.querySelectorAll(".status-dot")) dot.classList.toggle("connected", v);
});
window.arc.on("sound", (v) => (sound = v));
window.arc.on("voice", (v) => {
  voice = v;
  document.body.classList.toggle("listening", v.state === "listening");
  document.body.dataset.voice = v.state;
  const label = bands.querySelector(".chosen .label");
  if (label && !expanded) {
    label.replaceChildren();
    const caption =
      {
        listening: "Listening…",
        finishing: "Transcribing…",
        sending: "Sending…",
        sent: "Sent",
        error: "Voice unavailable",
      }[v.state] || modes[selected][0];
    label.textContent = caption;
  }
});
window.arc.on("hold", (v) => {
  held = v;
  if (!v) preciseSound.stop();
  if (editor.active) return;
  if (v) {
    selected = 3;
    expanded = false;
    ringOffsets[1] = ringOffsets[2] = 0;
    ringAngles.fill(0);
    window.arc.action({ type: "depth", depth: 0 });
    render(true);
  }
});
window.arc.on("targets", (v) => {
  voiceTargets = v.targets;
  const preferred = v.selectedId;
  if (!voiceTarget || !voiceTargets.some((t) => t.id === voiceTarget))
    voiceTarget = voiceTargets.find((t) => t.id === preferred)?.id || voiceTargets[0]?.id || "";
});
window.arc.on("preferences", (v) => {
  const changed =
    (v.theme && v.theme !== preferences.theme) ||
    (v.layout && JSON.stringify(v.layout) !== JSON.stringify(preferences.layout));
  preferences = { ...preferences, ...v };
  applyPreferences();
  if (changed && !editor.active) render();
});
window.arc.on("edit", (v) => {
  if (v === false && editor.active) editor.finish(false);
});
function rotateArc(direction) {
  if (editor.active) return;
  const delta = typeof direction === "object" ? direction?.delta : direction;
  const step = Math.sign(delta);
  if (!Number.isFinite(delta) || !step) return;
  if (direction?.pointer && Number.isFinite(direction.pointer.x) && Number.isFinite(direction.pointer.y))
    pointer = direction.pointer;
  const l = arcLayout(innerWidth, innerHeight, 3, preferences.layout),
    radius = pointer ? Math.hypot((pointer.x - l.offset) / l.scale - l.cx, (pointer.y - l.top) / l.scale - l.cy) : -1;
  const index = l.rings.findIndex(([a, b]) => radius >= a && radius <= b);
  const target = index > 0 ? bands.querySelector(`[data-depth="${index}"]`) : null;
  if (preferences.motion === "precise" || preferences.motion === "mechanical") {
    const depth = target ? index : 0,
      node = target || bands.querySelector(".ring-primary");
    if (!node) return;
    // Keep the same SVG hit targets and cumulative angle; no selection, snap or drift.
    node.getAnimations().forEach((a) => {
      a.cancel();
    });
    node.classList.remove("ring-revealing");
    if (preferences.motion === "mechanical") {
      mechanicalMove(node, depth, delta);
      action("browse");
      voice = { state: "idle" };
      return;
    }
    ringAngles[depth] = preciseRotation(ringAngles[depth], delta);
    // Apply wheel and counter-rotation in the same paint, without a smoothing queue.
    applyPreciseAngle(node, depth);
    action("browse");
    voice = { state: "idle" };
    if (sound) preciseSound.move(delta, preferences.volume);
    return;
  }
  if (target) {
    const data = ringRows.get(index),
      m = new DOMMatrixReadOnly(getComputedStyle(target).transform),
      angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    ringOffsets[index] = (ringOffsets[index] + step + data.items.length) % data.items.length;
    target.getAnimations().forEach((a) => {
      a.cancel();
    });
    target.remove();
    cue();
    action("browse");
    row(data.inner, data.outer, data.items, index, true, step, angle);
    return;
  }
  selected = turn(selected, step);
  cue();
  action("browse");
  voice = { state: "idle" };
  render(true, step);
}
window.arc.on("rotate", rotateArc);
document.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    rotateArc({ delta: Math.sign(event.deltaY), pointer: { x: event.clientX, y: event.clientY } });
  },
  { passive: false },
);
window.arc.on("visibility", (v) => {
  if (!v) {
    resetMechanical();
    preciseSound.stop();
  }
  if (editor.active && !v) return;
  // Keep the material visible until geometry reaches a genuine zero-radius point.
  const seed = { transform: "rotate(-150deg) scale(0)", opacity: 1 };
  const resting = { transform: "rotate(0deg) scale(1)", opacity: 1 };
  // Capture before cancellation so rapid release/re-summon never jumps to full size.
  const interrupted = entryAnimation && entryAnimation.playState !== "finished";
  const current = { transform: getComputedStyle(bands).transform, opacity: getComputedStyle(bands).opacity };
  const entering = v && !visible;
  visible = v;
  if (v && !entering) return;
  document.body.classList.toggle("exiting", !v);
  if (!v) {
    entryAnimation?.cancel();
    entryAnimation = null;
    if (preferences.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.body.classList.add("leaving");
      action("exited");
      return;
    }
    entryAnimation = bands.animate([current, seed], {
      duration: dialMotion(preferences.motion).exit,
      easing: DIAL_EASING.exit,
      fill: "forwards",
    });
    entryAnimation.finished
      .then(() => {
        if (!visible) {
          document.body.classList.add("leaving");
          action("exited");
        }
      })
      .catch(() => {});
    return;
  }
  entryAnimation?.cancel();
  entryAnimation = null;
  document.body.classList.remove("leaving");
  if (entering && preferences.motion !== "reduced" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    action("entering");
    entryAnimation = bands.animate([interrupted ? current : seed, resting], {
      duration: dialMotion(preferences.motion).enter,
      easing: DIAL_EASING.out,
    });
    entryAnimation.finished.then(() => action("entered")).catch(() => {});
  }
});
// The guide's lens upgrade is optional. CSS cannot refract pixels belonging to
// another native window; no desktop screenshots are collected for this effect.
try {
  if (
    (navigator.hardwareConcurrency || 4) >= 6 &&
    (navigator.deviceMemory === undefined || navigator.deviceMemory >= 6) &&
    window.chrome &&
    CSS.supports("backdrop-filter", "url(#sa-lens)")
  )
    document.documentElement.classList.add("sa-lens-on");
} catch {}
let lightFrame = 0;
document.addEventListener(
  "pointermove",
  (event) => {
    if (lightFrame || preferences.motion === "reduced") return;
    const target = event.target.closest?.(".cell");
    if (!target) return;
    lightFrame = requestAnimationFrame(() => {
      lightFrame = 0;
      const r = target.getBoundingClientRect();
      target.style.setProperty("--sa-lx", `${((event.clientX - r.x) / r.width) * 100}%`);
      target.style.setProperty("--sa-ly", `${((event.clientY - r.y) / r.height) * 100}%`);
    });
  },
  { passive: true },
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (controlPage) {
      controlPage = "";
      render(false, 0, true);
    } else if (teamPage) {
      teamPage = false;
      render(false, 0, true);
    } else if (expanded) setExpanded(false);
    else action("close");
  }
});
window.addEventListener("resize", () => render());
applyPreferences();
render();
window.arc.action({ type: "ready" });
