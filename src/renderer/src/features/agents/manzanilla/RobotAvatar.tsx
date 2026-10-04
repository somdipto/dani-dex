import { createEffect, createSignal, Show, untrack } from "solid-js";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DirectionalLight,
  type Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import {
  createRobotModel,
  disposeRobotModel,
  inferRobotRole,
  poseRobotModel,
  type RobotMotion,
  type RobotRole,
  resolveRobotColor,
} from "./robot-model";
import "./robot-avatar.css";

export type RobotAvatarProps = {
  size?: number;
  label: string;
  color?: string;
  role?: RobotRole;
  state?: string;
  animated?: boolean;
  motion?: RobotMotion;
  className?: string;
  motionKey?: string | number;
};

type AvatarInstance = {
  canvas: HTMLCanvasElement;
  element: HTMLSpanElement;
  context: CanvasRenderingContext2D | null;
  size: number;
  role: RobotRole;
  color: string;
  motion: RobotMotion;
  animated: boolean;
  seed: number;
  visible: boolean;
  dirty: boolean;
  ready: boolean;
  waveStarted: number | null;
  motionStarted: number | null;
  motionCompleted: boolean;
  onReady: (ready: boolean) => void;
  onFailure: (reason: string) => void;
};

type RenderStage = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  texture: CanvasTexture;
  onLost: (event: Event) => void;
  onRestored: () => void;
};

const FRAME_INTERVAL = 1000 / 30;
const MAX_IMAGE_SIZE = 384;
const MODEL_CACHE_LIMIT = 24;
const THUMBNAIL_CACHE_LIMIT = 64;
const RELEASE_DELAY = 8_000;
const WAVE_DURATION = 1_700;
const LIVE_AVATAR_SIZE = 80;

// No browser or GPU resources are created at module load (including during SSR).
const instances = new Map<HTMLSpanElement, AvatarInstance>();
const models = new Map<string, Group>();
const thumbnails = new Map<string, HTMLCanvasElement>();
let stage: RenderStage | null = null;
let observer: IntersectionObserver | null = null;
let motionPreference: MediaQueryList | null = null;
let frameRequest = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let lastFrame = -Infinity;
let animationTime = 0;
let unavailable = false;
let listening = false;

function setReady(instance: AvatarInstance, ready: boolean) {
  if (instance.ready === ready) return;
  instance.ready = ready;
  instance.onReady(ready);
}

function seedFromLabel(label: string) {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i++) hash = Math.imul(hash ^ label.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967295;
}

function motionFromState(state?: string): "idle" | "working" | "waiting" {
  if (state && /^(busy|working|thinking|running|executing|speaking)$/i.test(state)) return "working";
  if (state && /^(waiting|waiting-on-you|approval|needs-review)$/i.test(state)) return "waiting";
  return "idle";
}

function motionDuration(motion: RobotMotion) {
  if (motion === "sit") return 8_000;
  if (motion === "laugh") return 2_000;
  if (motion === "blink") return 450;
  if (motion === "celebrate" || motion === "cheer" || motion === "point") return 1_400;
  if (motion === "jump") return 1_000;
  if (motion === "wave") return WAVE_DURATION;
  return 0;
}

function wantsLiveFrame(instance: AvatarInstance, reduced: boolean) {
  return (
    instance.animated &&
    !reduced &&
    (instance.size >= LIVE_AVATAR_SIZE ||
      instance.waveStarted !== null ||
      (motionDuration(instance.motion) > 0 && !instance.motionCompleted))
  );
}

function modelFor(role: RobotRole, color: string) {
  const key = `${role}:${color}`;
  const existing = models.get(key);
  if (existing) {
    models.delete(key);
    models.set(key, existing);
    return existing;
  }
  const model = createRobotModel(role, color);
  models.set(key, model);
  while (models.size > MODEL_CACHE_LIMIT) {
    const oldest = models.entries().next().value;
    if (!oldest) break;
    models.delete(oldest[0]);
    disposeRobotModel(oldest[1]);
  }
  return model;
}

function failRendering(reason: string) {
  for (const instance of instances.values()) {
    setReady(instance, false);
    instance.onFailure(reason);
  }
}

function ensureStage() {
  if (stage || unavailable) return stage;
  let renderer: WebGLRenderer | undefined;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1.76, 1.76, 1.76, -1.76, 0.1, 30);
    camera.position.set(3, 2.4, 7);
    camera.lookAt(0, 1.36, 0);
    scene.add(new HemisphereLight(0xffffff, 0xa2b3b2, 2.1));
    const key = new DirectionalLight(0xfff8ef, 3.2);
    key.position.set(-3, 6, 5);
    scene.add(key);
    const fill = new DirectionalLight(0xd9eaff, 1.5);
    fill.position.set(4, 3, -2);
    scene.add(fill);

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 96;
    const shadowContext = shadowCanvas.getContext("2d");
    if (shadowContext) {
      const gradient = shadowContext.createRadialGradient(48, 48, 4, 48, 48, 48);
      gradient.addColorStop(0, "rgba(34, 49, 51, .23)");
      gradient.addColorStop(0.5, "rgba(34, 49, 51, .11)");
      gradient.addColorStop(1, "rgba(34, 49, 51, 0)");
      shadowContext.fillStyle = gradient;
      shadowContext.fillRect(0, 0, 96, 96);
    }
    const texture = new CanvasTexture(shadowCanvas);
    const shadow = new Mesh(
      new PlaneGeometry(2.6, 1.9),
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    scene.add(shadow);

    const onLost = (event: Event) => {
      event.preventDefault();
      unavailable = true;
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      failRendering("3D renderer lost its graphics context.");
    };
    const onRestored = () => {
      unavailable = false;
      thumbnails.clear();
      invalidate();
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.domElement.addEventListener("webglcontextrestored", onRestored);
    stage = { renderer, scene, camera, shadow, texture, onLost, onRestored };
    return stage;
  } catch (error) {
    failRendering(
      error instanceof Error ? `3D renderer could not start: ${error.message}` : "3D renderer could not start.",
    );
    renderer?.dispose();
    renderer?.forceContextLoss();
    unavailable = true;
    return null;
  }
}

function releaseStage() {
  if (stage) {
    const { renderer, shadow, texture, onLost, onRestored } = stage;
    renderer.domElement.removeEventListener("webglcontextlost", onLost);
    renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
    shadow.geometry.dispose();
    shadow.material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    stage = null;
  }
  for (const model of models.values()) disposeRobotModel(model);
  models.clear();
  thumbnails.clear();
}

function rememberThumbnail(key: string, canvas: HTMLCanvasElement) {
  const thumbnail = document.createElement("canvas");
  thumbnail.width = canvas.width;
  thumbnail.height = canvas.height;
  const context = thumbnail.getContext("2d");
  if (!context) return;
  context.drawImage(canvas, 0, 0);
  thumbnails.set(key, thumbnail);
  while (thumbnails.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnails.keys().next().value;
    if (oldest === undefined) break;
    thumbnails.delete(oldest);
  }
}

function draw(instance: AvatarInstance, now: number, reduced: boolean) {
  const context = instance.context;
  if (!context) return;
  const pixels = Math.max(
    1,
    Math.min(MAX_IMAGE_SIZE, Math.round(instance.size * Math.min(window.devicePixelRatio || 1, 2))),
  );
  if (instance.canvas.width !== pixels || instance.canvas.height !== pixels) {
    instance.canvas.width = instance.canvas.height = pixels;
  }
  if (instance.waveStarted !== null && now - instance.waveStarted >= WAVE_DURATION) instance.waveStarted = null;
  const duration = motionDuration(instance.motion);
  const canMove = instance.animated && !reduced;
  if (canMove && duration > 0 && !instance.motionCompleted) {
    instance.motionStarted ??= now;
    if (now - instance.motionStarted >= duration) instance.motionCompleted = true;
  }
  const waving = canMove && instance.waveStarted !== null;
  const oneShot = canMove && duration > 0 && !instance.motionCompleted;
  const motion = waving ? "wave" : instance.motionCompleted ? "idle" : instance.motion;
  const still = !canMove || (instance.size < LIVE_AVATAR_SIZE && !waving && !oneShot);
  const cacheKey = `${instance.role}:${instance.color}:${pixels}:${motion}`;
  const cached = still ? thumbnails.get(cacheKey) : undefined;
  if (cached) {
    thumbnails.delete(cacheKey);
    thumbnails.set(cacheKey, cached);
    context.clearRect(0, 0, pixels, pixels);
    context.drawImage(cached, 0, 0);
    setReady(instance, true);
    return;
  }

  const current = ensureStage();
  if (!current) return;
  const model = modelFor(instance.role, instance.color);
  const time = still
    ? 0
    : waving
      ? (now - (instance.waveStarted ?? now)) / 1000
      : oneShot
        ? (now - (instance.motionStarted ?? now)) / 1000
        : animationTime;
  // Stills use an open-eyed neutral phase, shared by equivalent role thumbnails.
  poseRobotModel(model, { motion, time, seed: still ? 0 : instance.seed });
  current.scene.add(model);
  try {
    current.renderer.setSize(pixels, pixels, false);
    current.renderer.render(current.scene, current.camera);
    // Copy synchronously before the shared WebGL drawing buffer is reused.
    context.clearRect(0, 0, pixels, pixels);
    context.drawImage(current.renderer.domElement, 0, 0);
  } finally {
    current.scene.remove(model);
  }
  if (still) rememberThumbnail(cacheKey, instance.canvas);
  setReady(instance, true);
}

function hasWork() {
  if (unavailable || document.hidden) return false;
  const reduced = motionPreference?.matches ?? false;
  for (const instance of instances.values()) {
    if (instance.visible && instance.context && (instance.dirty || wantsLiveFrame(instance, reduced))) return true;
  }
  return false;
}

function requestFrame() {
  if (!frameRequest && hasWork()) frameRequest = requestAnimationFrame(tick);
}

function tick(now: number) {
  frameRequest = 0;
  if (!hasWork()) return;
  if (now - lastFrame < FRAME_INTERVAL) {
    requestFrame();
    return;
  }
  animationTime += Number.isFinite(lastFrame) ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
  lastFrame = now;
  const reduced = motionPreference?.matches ?? false;
  try {
    for (const instance of instances.values()) {
      if (!instance.visible || !instance.context || (!instance.dirty && !wantsLiveFrame(instance, reduced))) continue;
      draw(instance, now, reduced);
      instance.dirty = false;
    }
  } catch (error) {
    unavailable = true;
    failRendering(error instanceof Error ? `3D frame failed: ${error.message}` : "3D frame failed.");
    releaseStage();
  }
  requestFrame();
}

function inViewport(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.left < window.innerWidth
  );
}

function invalidate() {
  for (const instance of instances.values()) {
    instance.dirty = true;
    if (!observer) instance.visible = inViewport(instance.element);
  }
  requestFrame();
}

function visibilityChanged() {
  cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  if (!document.hidden) invalidate();
}

function startListening() {
  if (listening) return;
  listening = true;
  unavailable = false;
  motionPreference =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  motionPreference?.addEventListener("change", invalidate);
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("resize", invalidate);
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const instance = entry.target instanceof HTMLSpanElement ? instances.get(entry.target) : undefined;
          if (!instance) continue;
          instance.visible = entry.isIntersecting && entry.intersectionRatio > 0;
          if (instance.visible) instance.dirty = true;
        }
        requestFrame();
      },
      { threshold: 0 },
    );
  } else {
    window.addEventListener("scroll", invalidate, true);
  }
}

function stopListening() {
  cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  observer?.disconnect();
  observer = null;
  motionPreference?.removeEventListener("change", invalidate);
  motionPreference = null;
  document.removeEventListener("visibilitychange", visibilityChanged);
  window.removeEventListener("resize", invalidate);
  window.removeEventListener("scroll", invalidate, true);
  listening = false;
  releaseStage();
  unavailable = false;
  lastFrame = -Infinity;
}

function register(instance: AvatarInstance) {
  if (releaseTimer !== null) clearTimeout(releaseTimer);
  releaseTimer = null;
  startListening();
  instances.set(instance.element, instance);
  if (observer) observer.observe(instance.element);
  else instance.visible = inViewport(instance.element);
  requestFrame();
  return () => {
    observer?.unobserve(instance.element);
    instances.delete(instance.element);
    if (!instances.size) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (!instances.size) stopListening();
      }, RELEASE_DELAY);
    }
  };
}

function greet(instance: AvatarInstance) {
  if (!instance.animated || motionPreference?.matches || document.hidden || !instance.visible) return;
  instance.waveStarted = performance.now();
  instance.dirty = true;
  requestFrame();
}

/** Solid adapter around the supplied Manzanilla model and its shared 30fps renderer. */
export function RobotAvatar(props: RobotAvatarProps) {
  let element: HTMLSpanElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let instance: AvatarInstance | null = null;
  let previousMotionKey = props.motionKey;
  const [ready, updateReady] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const label = () => (typeof props.label === "string" && props.label.trim() ? props.label : "AI agent");
  const role = () => props.role ?? inferRobotRole(label());
  const validSize = () => (Number.isFinite(props.size) ? Math.max(16, Math.min(props.size ?? 64, 1024)) : 64);
  const resolvedColor = () => resolveRobotColor(role(), props.color);
  const resolvedMotion = () => props.motion ?? motionFromState(props.state);

  createEffect(
    () => [validSize(), label(), role(), resolvedColor(), resolvedMotion(), props.animated ?? true] as const,
    ([size, name, selected, color, motion, animated]) =>
      untrack(() => {
        if (!element || !canvas) return;
        updateReady(false);
        setFailure(null);
        const current: AvatarInstance = {
          element,
          canvas,
          context: canvas.getContext("2d"),
          size,
          role: selected,
          color,
          motion,
          animated,
          seed: seedFromLabel(name),
          visible: false,
          dirty: true,
          ready: false,
          waveStarted: null,
          motionStarted: null,
          motionCompleted: false,
          onReady: (ready) => {
            updateReady(ready);
            if (ready) setFailure(null);
          },
          onFailure: setFailure,
        };
        if (!current.context) setFailure("3D avatar cannot display: canvas drawing is unavailable.");
        instance = current;
        const unregister = untrack(() => register(current));
        const owner = element.closest('button, a[href], [role="button"], [tabindex]') ?? element;
        const greetOnInteraction = () => greet(current);
        owner.addEventListener("pointerenter", greetOnInteraction);
        owner.addEventListener("focusin", greetOnInteraction);
        return () => {
          owner.removeEventListener("pointerenter", greetOnInteraction);
          owner.removeEventListener("focusin", greetOnInteraction);
          instance = null;
          // Disposal runs in the parent render scope; the next apply resets readiness.
          unregister();
        };
      }),
  );
  createEffect(
    () => props.motionKey,
    (next) => {
      if (next === previousMotionKey || !instance) return;
      previousMotionKey = next;
      if (motionDuration(instance.motion) > 0) {
        instance.motionStarted = null;
        instance.motionCompleted = false;
        instance.dirty = true;
        requestFrame();
      } else greet(instance);
    },
  );

  return (
    <span
      ref={element}
      class={`mz-robot-avatar${ready() ? " is-ready" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={{ width: `${validSize()}px`, height: `${validSize()}px` }}
      role="img"
      aria-label={failure() ? `${label()}. 3D avatar unavailable.` : label()}
      title={failure() ?? label()}
      data-robot-error={failure() ?? undefined}
      data-robot-role={role()}
      data-robot-motion={resolvedMotion()}
      data-robot-renderer={ready() ? "webgl" : failure() ? "unavailable" : "loading"}
    >
      <span class="mz-robot-placeholder" aria-hidden="true">
        {failure() ? "3D unavailable" : "Loading 3D"}
      </span>
      <canvas ref={canvas} class="mz-robot-canvas" />
      <Show when={failure()}>
        <span class="mz-robot-error" aria-hidden="true">
          !
        </span>
      </Show>
    </span>
  );
}
