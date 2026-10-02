import * as THREE from "three";
import { createRobotModel, disposeRobotModel, poseRobotModel, type RobotMotion } from "./robot-model";

declare global {
  interface Window {
    renderRobot: (color: string, motion: RobotMotion, time: number) => string;
  }
}
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(256, 256);
renderer.setPixelRatio(1);
renderer.setClearColor(0, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, 0.1, 30);
camera.position.set(3.3, 2.8, 7);
camera.lookAt(0, 1.1, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x737184, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(-3, 5, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc4e4ff, 1.3);
fill.position.set(4, 2, -3);
scene.add(fill);
let robot: THREE.Group | undefined;
window.renderRobot = (color, motion, time) => {
  if (robot) {
    scene.remove(robot);
    disposeRobotModel(robot);
  }
  robot = createRobotModel("default", color);
  robot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (object.name === "face" && Array.isArray(material)) {
      const face = material[1];
      if (face instanceof THREE.MeshStandardMaterial) face.color.set(color);
    }
    if (object.name === "sole" && material instanceof THREE.MeshStandardMaterial) {
      material.color.set(color).multiplyScalar(0.66);
    }
  });
  scene.add(robot);
  poseRobotModel(robot, { motion, time });
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
};
