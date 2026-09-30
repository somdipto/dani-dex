import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Original, editable Manzanilla characters. Coordinates are metres; front is +Z. */
export const ROBOT_ROLES = [
  { id: "default", label: "General", color: "#F5F5F2" },
  { id: "chief", label: "Chief of staff", color: "#9561ED" },
  { id: "assistant", label: "Assistant", color: "#3299F4" },
  { id: "inbox", label: "Inbox manager", color: "#20BA78" },
  { id: "sales", label: "Sales", color: "#17B4BD" },
  { id: "talent", label: "Talent scout", color: "#A97C60" },
  { id: "growth", label: "Growth marketer", color: "#FF934F" },
  { id: "support", label: "Customer support", color: "#F54E98" },
  { id: "expense", label: "Expense manager", color: "#E65CAA" },
  { id: "invoice", label: "Invoice collector", color: "#7160E9" },
] as const;

export type RobotRole = (typeof ROBOT_ROLES)[number]["id"];
export type RobotMotion =
  | "idle"
  | "wave"
  | "blink"
  | "working"
  | "waiting"
  | "celebrate"
  | "walk"
  | "point"
  | "jump"
  | "sit"
  | "cheer"
  | "laugh";
export type RobotPose = { motion?: RobotMotion; time: number; seed?: number };

const rolePatterns: ReadonlyArray<readonly [RobotRole, RegExp]> = [
  ["chief", /\b(chief|chief of staff|cos|coordinator|director)\b/],
  ["inbox", /\b(inbox|email manager|mail manager|email triage|mailbox)\b/],
  ["invoice", /\b(invoice|invoices|billing|accounts receivable|collections)\b/],
  ["expense", /\b(expense|expenses|bookkeeper|bookkeeping|accountant)\b/],
  ["talent", /\b(talent|recruiter|recruiting|recruitment|human resources|hr)\b/],
  ["sales", /\b(sales|outbound|business development|prospecting|outreach)\b/],
  ["growth", /\b(growth|marketing|marketer|social media)\b/],
  ["support", /\b(customer support|customer service|helpdesk|support)\b/],
  ["assistant", /\b(assistant|executive assistant|ea|personal helper)\b/],
];

function normalized(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

/** A selected role is presentation, never evidence of an employee's permissions. */
export function inferRobotRole(name: string, title?: string, responsibilities?: string): RobotRole {
  for (const source of [normalized(title), normalized(name), normalized(responsibilities)]) {
    for (const [role, pattern] of rolePatterns) if (pattern.test(source)) return role;
  }
  return "default";
}

const colorPresets: Record<string, string> = {
  white: "#F5F5F2",
  purple: "#9561ED",
  violet: "#9561ED",
  blue: "#3299F4",
  green: "#20BA78",
  teal: "#17B4BD",
  cyan: "#17B4BD",
  brown: "#A97C60",
  orange: "#FF934F",
  coral: "#ED6383",
  red: "#ED6383",
  pink: "#E65CAA",
  indigo: "#7160E9",
};

export function resolveRobotColor(role: RobotRole = "default", color?: string): string {
  const value = color?.trim().toLowerCase();
  if (value && /^#[\da-f]{6}$/.test(value)) return value.toUpperCase();
  if (value && /^#[\da-f]{3}$/.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("")}`.toUpperCase();
  if (value && Object.hasOwn(colorPresets, value)) return colorPresets[value];
  return ROBOT_ROLES.find((item) => item.id === role)?.color ?? ROBOT_ROLES[0].color;
}

type RobotRig = {
  body: THREE.Group;
  head: THREE.Group;
  sprout: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  leftSmile: THREE.Mesh;
  rightSmile: THREE.Mesh;
};

function material(color: THREE.ColorRepresentation, roughness = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.015,
    clearcoat: 0.38,
    clearcoatRoughness: 0.29,
  });
}

function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, surface);
  object.name = name;
  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function roundBox(
  parent: THREE.Object3D,
  name: string,
  dimensions: [number, number, number],
  radius: number,
  surface: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  return mesh(parent, name, new RoundedBoxGeometry(...dimensions, 5, radius), surface, position);
}

function ellipsoid(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  surface: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const object = mesh(parent, name, new THREE.SphereGeometry(1, 28, 20), surface, position);
  object.scale.set(...size);
  return object;
}

const BODY_EXPONENT = 0.78;
const BODY_HALF_WIDTH = 0.91;
const BODY_HALF_HEIGHT = 0.95;
const BODY_HALF_DEPTH = 0.71;
const BODY_CENTER_Y = -0.17;
const signedPower = (value: number, power: number): number => Math.sign(value) * Math.abs(value) ** power;

/** One seamless, softly squared egg; lower-shell colour is a material region. */
function makeBody(parent: THREE.Group, name: string, upper: THREE.Material, lower: THREE.Material): THREE.Mesh {
  const positions: number[] = [],
    indices: number[] = [];
  const latitudes = Array.from({ length: 41 }, (_, index) => -Math.PI / 2 + (index / 40) * Math.PI);
  const seam = Math.asin(signedPower((-0.51 - BODY_CENTER_Y) / BODY_HALF_HEIGHT, 1 / BODY_EXPONENT));
  latitudes.push(seam);
  latitudes.sort((a, b) => a - b);
  const segments = 64;
  for (const latitude of latitudes) {
    const ring = signedPower(Math.cos(latitude), BODY_EXPONENT);
    for (let segment = 0; segment <= segments; segment++) {
      const longitude = (segment / segments) * Math.PI * 2;
      positions.push(
        BODY_HALF_WIDTH * ring * signedPower(Math.sin(longitude), BODY_EXPONENT),
        BODY_CENTER_Y + BODY_HALF_HEIGHT * signedPower(Math.sin(latitude), BODY_EXPONENT),
        BODY_HALF_DEPTH * ring * signedPower(Math.cos(longitude), BODY_EXPONENT),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (let row = 0; row < latitudes.length - 1; row++) {
    const start = indices.length;
    for (let segment = 0; segment < segments; segment++) {
      const a = row * (segments + 1) + segment,
        b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    geometry.addGroup(start, indices.length - start, (latitudes[row] + latitudes[row + 1]) / 2 < seam ? 1 : 0);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const object = new THREE.Mesh(geometry, [upper, lower]);
  object.name = name;
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

function surfaceDepth(x: number, y: number): number {
  const power = 2 / BODY_EXPONENT;
  const remaining =
    1 - Math.abs(x / BODY_HALF_WIDTH) ** power - Math.abs((y - BODY_CENTER_Y) / BODY_HALF_HEIGHT) ** power;
  return BODY_HALF_DEPTH * Math.max(0.001, remaining) ** (1 / power);
}

/** The role face conforms to the egg, rather than resembling a flat screen. */
function makeFace(parent: THREE.Object3D, surface: THREE.Material): THREE.Mesh {
  const rings = 16,
    segments = 64;
  const positions: number[] = [0, 0.045, surfaceDepth(0, 0.045) + 0.012];
  const indices: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const cosine = Math.cos(angle),
        sine = Math.sin(angle);
      const squircle = (Math.abs(cosine) ** 3.1 + Math.abs(sine) ** 3.1) ** (-1 / 3.1);
      const x = ((0.755 * ring) / rings) * squircle * cosine;
      const y = 0.045 + ((0.575 * ring) / rings) * squircle * sine;
      positions.push(x, y, surfaceDepth(x, y) + 0.012);
    }
  }
  for (let segment = 0; segment < segments; segment++) indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
  for (let ring = 1; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = 1 + (ring - 1) * segments + segment;
      const b = 1 + (ring - 1) * segments + ((segment + 1) % segments);
      const c = a + segments,
        d = b + segments;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(parent, "face", geometry, surface, [0, 0, 0]);
}

function group(parent: THREE.Object3D, name: string, position: [number, number, number]): THREE.Group {
  const object = new THREE.Group();
  object.name = name;
  object.position.set(...position);
  parent.add(object);
  return object;
}

function line(
  parent: THREE.Object3D,
  name: string,
  points: [number, number, number][],
  surface: THREE.Material,
  radius = 0.014,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  return mesh(parent, name, new THREE.TubeGeometry(curve, 18, radius, 8, false), surface, [0, 0, 0]);
}

function makeLeaf(
  parent: THREE.Object3D,
  name: string,
  surface: THREE.Material,
  position: [number, number, number],
  rotation: number,
  scale = 1,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.14, 0.12, -0.16, 0.36, -0.035, 0.49);
  shape.bezierCurveTo(0.14, 0.46, 0.17, 0.19, 0, 0);
  const leaf = mesh(
    parent,
    name,
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.025,
      bevelEnabled: true,
      bevelSize: 0.035,
      bevelThickness: 0.035,
      bevelSegments: 4,
      curveSegments: 12,
      steps: 1,
    }),
    surface,
    position,
  );
  leaf.rotation.z = rotation;
  leaf.rotation.y = -0.15;
  leaf.scale.setScalar(scale);
  return leaf;
}

function addHeadset(head: THREE.Group, shell: THREE.Material, ink: THREE.Material): void {
  const arc = mesh(head, "headset-band", new THREE.TorusGeometry(0.87, 0.035, 10, 42, Math.PI), ink, [0, -0.02, 0.08]);
  arc.scale.y = 0.98;
  for (const side of [-1, 1]) {
    ellipsoid(head, `headset-ear-${side}`, [0.12, 0.235, 0.19], ink, [side * 0.865, -0.09, 0.18]);
    ellipsoid(head, `headset-shell-${side}`, [0.06, 0.175, 0.145], shell, [side * 0.94, -0.09, 0.19]);
  }
  line(
    head,
    "headset-boom",
    [
      [0.88, -0.16, 0.28],
      [0.79, -0.35, 0.61],
      [0.49, -0.39, 0.77],
    ],
    ink,
    0.026,
  );
  ellipsoid(head, "headset-microphone", [0.09, 0.055, 0.055], ink, [0.46, -0.39, 0.77]);
}

function addTablet(hand: THREE.Group, ink: THREE.Material, screen: THREE.Material): void {
  const tablet = group(hand, "tablet", [-0.19, -0.17, 0.77]);
  tablet.rotation.set(-0.13, -0.16, -0.04);
  roundBox(tablet, "tablet-frame", [0.55, 0.66, 0.09], 0.055, ink, [0, 0, 0]);
  roundBox(tablet, "tablet-screen", [0.45, 0.53, 0.02], 0.028, screen, [0, 0.015, 0.055]);
  const glint = material("#BCC9D8", 0.45);
  for (let i = 0; i < 3; i++)
    roundBox(tablet, `tablet-line-${i}`, [i === 2 ? 0.19 : 0.31, 0.023, 0.011], 0.008, glint, [
      -0.04,
      0.14 - i * 0.09,
      0.071,
    ]);
}

function addDocument(hand: THREE.Group, role: RobotRole, white: THREE.Material, accent: THREE.Material): void {
  const paper = group(hand, role === "expense" ? "receipt" : "document", [-0.13, -0.15, 0.79]);
  paper.rotation.set(-0.07, -0.16, -0.08);
  if (role === "expense") {
    const shape = new THREE.Shape();
    shape.moveTo(-0.255, 0.38);
    shape.lineTo(0.255, 0.38);
    shape.lineTo(0.255, -0.33);
    for (let i = 0; i < 7; i++) shape.lineTo(0.255 - i * 0.085, i % 2 === 0 ? -0.37 : -0.32);
    shape.lineTo(-0.255, 0.38);
    mesh(
      paper,
      "receipt-paper",
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.035,
        bevelEnabled: true,
        bevelSize: 0.013,
        bevelThickness: 0.012,
        bevelSegments: 2,
      }),
      white,
      [0, 0, 0],
    );
  } else {
    roundBox(paper, "document-paper", [0.54, 0.7, 0.055], 0.034, white, [0, 0, 0]);
  }
  roundBox(paper, "document-heading", [0.21, 0.055, 0.013], 0.01, accent, [-0.07, 0.23, 0.055]);
  const print = material("#BBC1C9", 0.5);
  for (let i = 0; i < 4; i++)
    roundBox(paper, `document-line-${i}`, [i === 3 ? 0.2 : 0.34, 0.025, 0.015], 0.009, print, [
      i === 3 ? -0.07 : 0,
      0.1 - i * 0.105,
      0.055,
    ]);
}

function addAccessories(
  role: RobotRole,
  rig: RobotRig,
  shell: THREE.Material,
  white: THREE.Material,
  ink: THREE.Material,
): void {
  const { head, rightArm } = rig;
  if (["chief", "talent", "inbox", "growth", "expense", "invoice"].includes(role)) {
    const hand = rightArm.getObjectByName("hand");
    hand?.position.set(0.12, -0.21, 0.79);
    line(
      rightArm,
      "holding-arm",
      [
        [0.018, -0.06, 0],
        [0.03, -0.15, 0.35],
        [0.12, -0.21, 0.72],
      ],
      white,
      0.095,
    );
  }
  if (role === "chief") {
    const gold = material("#F7BD45", 0.3);
    const crown = group(head, "crown", [0, 0.8, 0.06]);
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0);
    shape.lineTo(-0.38, 0.34);
    shape.lineTo(-0.17, 0.22);
    shape.lineTo(0, 0.43);
    shape.lineTo(0.17, 0.22);
    shape.lineTo(0.38, 0.34);
    shape.lineTo(0.32, 0);
    shape.closePath();
    mesh(
      crown,
      "crown-gold",
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.16,
        bevelEnabled: true,
        bevelSize: 0.025,
        bevelThickness: 0.022,
        bevelSegments: 3,
      }),
      gold,
      [0, 0, 0],
    );
    ellipsoid(crown, "crown-jewel", [0.042, 0.052, 0.022], shell, [0, 0.105, 0.188]);
    addTablet(rightArm, ink, material("#4B586F", 0.32));
  } else if (role === "assistant" || role === "support") {
    addHeadset(head, shell, ink);
  } else if (role === "inbox") {
    const envelope = group(rightArm, "envelope", [-0.14, -0.19, 0.79]);
    envelope.rotation.set(-0.04, -0.15, -0.06);
    roundBox(envelope, "envelope-paper", [0.65, 0.45, 0.07], 0.027, white, [0, 0, 0]);
    const seam = material("#96B3A5", 0.52);
    line(
      envelope,
      "envelope-flap",
      [
        [-0.29, 0.185, 0.045],
        [0, -0.015, 0.052],
        [0.29, 0.185, 0.045],
      ],
      seam,
      0.012,
    );
    line(
      envelope,
      "envelope-fold-left",
      [
        [-0.29, -0.18, 0.045],
        [-0.11, -0.025, 0.045],
      ],
      seam,
      0.01,
    );
    line(
      envelope,
      "envelope-fold-right",
      [
        [0.29, -0.18, 0.045],
        [0.11, -0.025, 0.045],
      ],
      seam,
      0.01,
    );
  } else if (role === "sales") {
    const megaphone = group(rightArm, "megaphone", [0.03, -0.06, 0.35]);
    megaphone.rotation.y = -0.3;
    const horn = mesh(
      megaphone,
      "megaphone-horn",
      new THREE.CylinderGeometry(0.25, 0.1, 0.46, 28, 1, true),
      material("#3685C5"),
      [0.12, 0.05, 0],
    );
    horn.rotation.z = -Math.PI / 2;
    const mouth = mesh(megaphone, "megaphone-mouth", new THREE.CircleGeometry(0.218, 28), ink, [0.355, 0.05, 0]);
    mouth.rotation.y = Math.PI / 2;
    const rim = mesh(
      megaphone,
      "megaphone-rim",
      new THREE.TorusGeometry(0.24, 0.032, 10, 32),
      material("#87C2EE"),
      [0.36, 0.05, 0],
    );
    rim.rotation.y = Math.PI / 2;
    roundBox(megaphone, "megaphone-handle", [0.1, 0.24, 0.11], 0.036, ink, [-0.01, -0.14, 0]);
  } else if (role === "talent") {
    for (const side of [-1, 1])
      mesh(head, `glasses-lens-${side}`, new THREE.TorusGeometry(0.225, 0.025, 9, 38), ink, [side * 0.33, 0.02, 0.766]);
    line(
      head,
      "glasses-bridge",
      [
        [-0.1, 0.04, 0.765],
        [0, 0.07, 0.77],
        [0.1, 0.04, 0.765],
      ],
      ink,
      0.022,
    );
    for (const side of [-1, 1])
      line(
        head,
        `glasses-temple-${side}`,
        [
          [side * 0.55, 0.03, 0.76],
          [side * 0.77, 0.05, 0.65],
          [side * 0.87, 0.04, 0.25],
        ],
        ink,
        0.023,
      );
    addTablet(rightArm, ink, material("#697383", 0.4));
  } else if (role === "growth") {
    const chart = group(rightArm, "growth-chart", [-0.14, -0.15, 0.79]);
    chart.rotation.set(-0.05, -0.15, -0.06);
    roundBox(chart, "chart-board", [0.59, 0.56, 0.06], 0.04, white, [0, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const height = 0.13 + i * 0.105;
      roundBox(chart, `chart-bar-${i}`, [0.088, height, 0.035], 0.018, shell, [
        -0.16 + i * 0.16,
        -0.19 + height / 2,
        0.05,
      ]);
    }
  } else if (role === "expense" || role === "invoice") {
    addDocument(rightArm, role, white, shell);
  }
}

export function createRobotModel(role: RobotRole = "default", color?: string): THREE.Group {
  const knownRole = ROBOT_ROLES.some((item) => item.id === role) ? role : "default";
  const root = new THREE.Group();
  root.name = `manzanilla-robot-${knownRole}`;
  root.userData.role = knownRole;
  root.userData.artwork = "Original procedural Manzanilla robot";
  const white = material("#FAFAF7", 0.33);
  const ink = material("#24272E", 0.39);
  const shell = material(resolveRobotColor(knownRole, color), 0.3);
  const base = knownRole === "default" ? material("#BBBCC4", 0.43) : shell;
  const sole =
    knownRole === "default"
      ? material("#999BA8", 0.48)
      : material(new THREE.Color(resolveRobotColor(knownRole, color)).multiplyScalar(0.66), 0.45);
  const leafGreen = material("#00B871", 0.3);

  const body = group(root, "body", [0, 0, 0]);
  const head = group(body, "head", [0, 1.49, 0]);
  makeBody(head, knownRole === "default" ? "face" : "outer-shell", knownRole === "default" ? white : shell, base);
  if (knownRole !== "default") makeFace(head, white);
  const eyeDepth = surfaceDepth(0.31, 0.065) + (knownRole === "default" ? 0.019 : 0.031);
  const leftEye = mesh(head, "eye-left", new THREE.CapsuleGeometry(0.085, 0.19, 6, 16), ink, [-0.31, 0.065, eyeDepth]);
  const rightEye = mesh(head, "eye-right", new THREE.CapsuleGeometry(0.085, 0.19, 6, 16), ink, [0.31, 0.065, eyeDepth]);
  leftEye.scale.z = rightEye.scale.z = 0.48;
  leftEye.rotation.z = rightEye.rotation.z = 0.075;
  const leftSmile = mesh(head, "eye-cheer-left", new THREE.TorusGeometry(0.1, 0.033, 9, 22, Math.PI), ink, [
    -0.31,
    0.025,
    eyeDepth + 0.015,
  ]);
  const rightSmile = mesh(head, "eye-cheer-right", new THREE.TorusGeometry(0.1, 0.033, 9, 22, Math.PI), ink, [
    0.31,
    0.025,
    eyeDepth + 0.015,
  ]);

  const leftArm = group(body, "arm-left", [-0.84, 1.0, 0.06]);
  const rightArm = group(body, "arm-right", [0.84, 1.0, 0.06]);
  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ] as const) {
    ellipsoid(arm, "shoulder-joint", [0.11, 0.13, 0.14], ink, [side * 0.018, -0.06, 0]);
    const forearm = mesh(arm, "hand", new THREE.CapsuleGeometry(0.155, 0.2, 6, 18), white, [side * 0.06, -0.2, 0.065]);
    forearm.scale.z = 0.82;
  }
  const leftFoot = group(root, "foot-left", [-0.37, 0.205, 0.09]);
  const rightFoot = group(root, "foot-right", [0.37, 0.205, 0.09]);
  for (const foot of [leftFoot, rightFoot]) {
    roundBox(foot, "ankle-joint", [0.29, 0.11, 0.34], 0.045, ink, [0, 0.14, -0.015]);
    ellipsoid(foot, "foot", [0.205, 0.145, 0.265], knownRole === "support" ? shell : white, [0, 0, 0]);
    roundBox(foot, "sole", [0.33, 0.066, 0.44], 0.03, sole, [0, -0.122, -0.005]);
  }
  const sprout = group(head, "sprout", [0.42, 0.7, 0.035]);
  if (knownRole !== "chief" && knownRole !== "support") {
    line(
      sprout,
      "leaf-stem",
      [
        [0, 0, 0],
        [0.015, 0.14, 0.005],
        [0.045, 0.24, 0],
      ],
      leafGreen,
      0.025,
    );
    makeLeaf(sprout, "leaf-tall", leafGreen, [0, 0.08, 0], -0.23, 0.94);
    makeLeaf(sprout, "leaf-small", leafGreen, [0.005, 0.06, 0.04], -1.06, 0.77);
  }
  if (knownRole === "support") ellipsoid(head, "helmet-cap", [0.3, 0.21, 0.28], shell, [0, 0.79, 0]);
  else if (knownRole !== "default" && knownRole !== "chief")
    ellipsoid(head, "helmet-cap", [0.34, 0.17, 0.3], shell, [-0.22, 0.71, -0.08]);

  const rig: RobotRig = {
    body,
    head,
    sprout,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    leftEye,
    rightEye,
    leftSmile,
    rightSmile,
  };
  root.userData.rig = rig;
  addAccessories(knownRole, rig, shell, white, ink);
  poseRobotModel(root, { motion: "idle", time: 0 });
  return root;
}

const ease = (value: number): number => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Pure time-driven posing; every animated transform is reset on every call. */
export function poseRobotModel(root: THREE.Group, { motion = "idle", time, seed = 0 }: RobotPose): void {
  const rig: RobotRig | undefined = root.userData.rig;
  if (!rig) return;
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const offset = Number.isFinite(seed) ? Math.abs(seed % 1) * 5.1 : 0;
  const clock = t + offset;
  const { body, head, sprout, leftArm, rightArm, leftFoot, rightFoot, leftEye, rightEye, leftSmile, rightSmile } = rig;
  body.position.set(0, Math.sin(clock * 2.7) * 0.007, 0);
  body.rotation.set(0, 0, 0);
  body.scale.set(1, 1, 1);
  head.position.set(0, 1.49, 0);
  head.rotation.set(Math.sin(clock * 1.45) * 0.017, Math.sin(clock * 1.04) * 0.045, 0);
  sprout.rotation.set(0, 0, Math.sin(clock * 2.7) * 0.026);
  leftArm.rotation.set(0, 0, -0.16);
  rightArm.rotation.set(0, 0, 0.16);
  leftFoot.position.set(-0.37, 0.205, 0.09);
  rightFoot.position.set(0.37, 0.205, 0.09);
  leftFoot.rotation.set(0, -0.06, 0);
  rightFoot.rotation.set(0, 0.06, 0);
  const blinkPhase = clock % 4.6;
  const blink = blinkPhase > 3.3 && blinkPhase < 3.46 ? 1 - 0.9 * Math.sin(((blinkPhase - 3.3) / 0.16) * Math.PI) : 1;
  leftEye.scale.set(1, blink, 0.48);
  rightEye.scale.set(1, blink, 0.48);
  leftEye.visible = rightEye.visible = true;
  leftSmile.visible = rightSmile.visible = false;
  leftSmile.scale.set(1, 1, 1);
  rightSmile.scale.set(1, 1, 1);

  if (motion === "blink") {
    const squeeze = 1 - 0.94 * Math.sin(THREE.MathUtils.clamp(t / 0.24, 0, 1) * Math.PI);
    leftEye.scale.y = rightEye.scale.y = squeeze;
  } else if (motion === "wave") {
    const phase = t % 2.2;
    const lift = ease(phase / 0.18) * (1 - ease((phase - 1.35) / 0.3));
    leftArm.rotation.z = -0.16 - lift * (2.11 + Math.sin(phase * 19) * 0.22);
    leftArm.rotation.x = -0.13 * lift;
    head.rotation.z = -0.06 * lift;
    head.rotation.y = -0.05 * lift;
    sprout.rotation.z += Math.sin(phase * 16) * lift * 0.045;
  } else if (motion === "working") {
    head.rotation.x = 0.13 + Math.sin(clock * 5.6) * 0.028;
    head.rotation.y = -0.035 + Math.sin(clock * 1.8) * 0.09;
    leftArm.rotation.x = -0.32 + Math.sin(clock * 9.0) * 0.12;
    rightArm.rotation.x = -0.18 + Math.sin(clock * 9.0 + 1.3) * 0.065;
    leftArm.rotation.z = -0.38;
    body.position.y = 0.006 + Math.sin(clock * 5.6) * 0.006;
  } else if (motion === "waiting") {
    head.rotation.z = Math.sin(clock * 1.7) * 0.075;
    head.rotation.y = Math.sin(clock * 1.2) * 0.13;
    rightFoot.rotation.x = Math.max(0, Math.sin(clock * 5)) * 0.12;
    leftArm.rotation.z -= Math.sin(clock * 2.5) * 0.025;
  } else if (motion === "walk") {
    const gait = Math.sin(clock * 9.5);
    const opposite = Math.sin(clock * 9.5 + Math.PI);
    leftFoot.position.z += gait * 0.12;
    rightFoot.position.z += opposite * 0.12;
    leftFoot.position.y += Math.max(0, gait) * 0.075;
    rightFoot.position.y += Math.max(0, opposite) * 0.075;
    leftFoot.rotation.x = gait * 0.28;
    rightFoot.rotation.x = opposite * 0.28;
    leftArm.rotation.x = opposite * 0.32;
    rightArm.rotation.x = gait * 0.25;
    body.position.y = Math.abs(gait) * 0.035;
    body.rotation.z = gait * 0.028;
    head.rotation.z = -gait * 0.018;
    sprout.rotation.z += gait * 0.05;
  } else if (motion === "point") {
    const lift = ease(t / 0.17) * (1 - ease((t - 1.0) / 0.4));
    rightArm.rotation.z += 1.4 * lift;
    rightArm.rotation.x = -0.24 * lift;
    head.rotation.y = 0.19 * lift;
    head.rotation.z = 0.045 * lift;
  } else if (motion === "jump") {
    const crouch = t < 0.16 ? Math.sin((t / 0.16) * Math.PI) : 0;
    const airborne = THREE.MathUtils.clamp((t - 0.16) / 0.6, 0, 1);
    const jump = Math.sin(airborne * Math.PI);
    const landing = t > 0.76 && t < 1 ? Math.sin(((t - 0.76) / 0.24) * Math.PI) : 0;
    const squash = crouch * 0.07 + landing * 0.035;
    body.position.y = jump * 0.32 - squash;
    body.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.4);
    leftFoot.position.y += jump * 0.28;
    rightFoot.position.y += jump * 0.28;
    leftFoot.rotation.x = -jump * 0.16;
    rightFoot.rotation.x = jump * 0.16;
    leftArm.rotation.z -= jump * 1.95;
    rightArm.rotation.z += jump * 1.85;
    head.rotation.z = -jump * 0.045;
    sprout.rotation.z -= jump * 0.08;
  } else if (motion === "laugh") {
    const lift = ease(t / 0.15) * (1 - ease((t - 1.55) / 0.45));
    body.rotation.z = Math.sin(t * 15) * 0.035 * lift;
    body.position.y += Math.abs(Math.sin(t * 14)) * 0.025 * lift;
    head.rotation.x = -0.07 * lift;
    leftArm.rotation.x = rightArm.rotation.x = -0.25 * lift;
    if (lift > 0.3) {
      leftEye.visible = rightEye.visible = false;
      leftSmile.visible = rightSmile.visible = true;
    }
  } else if (motion === "sit") {
    const settle = ease(t / 0.35) * (1 - ease((t - 7.5) / 0.5));
    body.position.y = -0.27 * settle;
    head.rotation.x = 0.015;
    leftFoot.position.set(-0.37 - 0.08 * settle, 0.205 - 0.015 * settle, 0.09 + 0.31 * settle);
    rightFoot.position.set(0.37 + 0.08 * settle, 0.205 - 0.015 * settle, 0.09 + 0.31 * settle);
    leftFoot.rotation.set(-0.92 * settle, -0.06 - 0.09 * settle, 0);
    rightFoot.rotation.set(-0.92 * settle, 0.06 + 0.09 * settle, 0);
    leftArm.rotation.z = -0.06;
    rightArm.rotation.z = 0.06;
    leftArm.rotation.x = rightArm.rotation.x = -0.12;
  } else if (motion === "celebrate" || motion === "cheer") {
    const phase = t % 1.4;
    const lift = ease(t / 0.16) * (1 - ease((t - 1.05) / 0.35));
    const jump = Math.max(0, Math.sin((phase / 1.4) * Math.PI * 2));
    const landing = Math.max(0, Math.sin(((phase - 0.7) / 0.7) * Math.PI));
    body.position.y = jump * (motion === "cheer" ? 0.025 : 0.13) * lift;
    body.scale.set(1 + landing * 0.035 * lift, 1 - landing * 0.04 * lift, 1 + landing * 0.025 * lift);
    leftArm.rotation.z += (-1.92 + Math.sin(clock * 14) * 0.15) * lift;
    rightArm.rotation.z += (1.76 - Math.sin(clock * 14) * 0.15) * lift;
    head.rotation.z = Math.sin(clock * 7) * 0.06 * lift;
    leftFoot.position.y += jump * (motion === "cheer" ? 0 : 0.09) * lift;
    rightFoot.position.y += jump * (motion === "cheer" ? 0 : 0.09) * lift;
    sprout.rotation.z += Math.sin(clock * 14) * 0.07 * lift;
    if (motion === "cheer" && lift > 0.45) {
      leftEye.visible = rightEye.visible = false;
      leftSmile.visible = rightSmile.visible = true;
      leftSmile.scale.y = rightSmile.scale.y = 0.75 + ease((lift - 0.45) / 0.3) * 0.25;
    }
  }
  root.updateMatrixWorld(true);
}

/** Materials are shared inside a character, so each GPU resource is released once. */
export function disposeRobotModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const surface of Array.isArray(object.material) ? object.material : [object.material]) materials.add(surface);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const surface of materials) surface.dispose();
  root.removeFromParent();
  root.clear();
  delete root.userData.rig;
}
