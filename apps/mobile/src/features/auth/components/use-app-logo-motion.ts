import { DeviceMotion } from "expo-sensors";
import { useCallback, useEffect, useRef } from "react";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";

export type AppLogoAnimation = "none" | "blink";

const BLINK_INTERVAL_MS = 4_800;
const BLINK_START_DELAY_MS = 2_112;
const BLINK_HALF_DURATION_MS = 96;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PRESS_DURATION_MS = 360;
const ORIENTATION_UPDATE_INTERVAL_MS = 100;
const ORIENTATION_ROTATION_DURATION_MS = 160;
const ORIENTATION_DEAD_ZONE_DEGREES = 1;
const MIN_PLANAR_GRAVITY = DeviceMotion.Gravity * 0.25;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function createBlinkAnimation(): number {
  return withRepeat(
    withSequence(
      ReduceMotion.Never,
      withDelay(BLINK_START_DELAY_MS, withTiming(0.94, { duration: BLINK_HALF_DURATION_MS, easing: EASE_IN_OUT })),
      withTiming(1, { duration: BLINK_HALF_DURATION_MS, easing: EASE_IN_OUT }),
      withDelay(BLINK_INTERVAL_MS - BLINK_START_DELAY_MS - BLINK_HALF_DURATION_MS * 2, withTiming(1, { duration: 0 })),
    ),
    -1,
    false,
    undefined,
    ReduceMotion.Never,
  );
}

export function useAppLogoMotion({
  animation,
  followDeviceOrientation,
}: {
  animation: AppLogoAnimation;
  followDeviceOrientation: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const deviceRotation = useSharedValue(0);
  const markScaleY = useSharedValue(1);
  const resumeBlinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDeviceAngle = useRef<number | null>(null);
  const accumulatedDeviceRotation = useRef(0);
  const renderedDeviceRotation = useRef(0);

  const stopMarkAnimation = useCallback(() => cancelAnimation(markScaleY), [markScaleY]);
  const startIdleBlink = useCallback(() => {
    stopMarkAnimation();
    markScaleY.set(1);
    if (animation === "blink" && !reduceMotion) markScaleY.set(createBlinkAnimation());
  }, [animation, markScaleY, reduceMotion, stopMarkAnimation]);

  useEffect(() => {
    startIdleBlink();

    return () => {
      if (resumeBlinkTimer.current) clearTimeout(resumeBlinkTimer.current);
      stopMarkAnimation();
    };
  }, [startIdleBlink, stopMarkAnimation]);

  useEffect(() => {
    if (!followDeviceOrientation) {
      cancelAnimation(deviceRotation);
      deviceRotation.set(0);
      lastDeviceAngle.current = null;
      accumulatedDeviceRotation.current = 0;
      renderedDeviceRotation.current = 0;
      return;
    }

    let active = true;
    let subscription: ReturnType<typeof DeviceMotion.addListener> | undefined;

    DeviceMotion.setUpdateInterval(ORIENTATION_UPDATE_INTERVAL_MS);
    void DeviceMotion.isAvailableAsync().then((available) => {
      if (!active || !available) return;

      subscription = DeviceMotion.addListener(({ acceleration, accelerationIncludingGravity }) => {
        const x = accelerationIncludingGravity.x - (acceleration?.x ?? 0);
        const y = accelerationIncludingGravity.y - (acceleration?.y ?? 0);
        if (Math.hypot(x, y) < MIN_PLANAR_GRAVITY) return;

        const deviceAngle = -Math.atan2(x, -y) * RADIANS_TO_DEGREES;
        const previousAngle = lastDeviceAngle.current;

        if (previousAngle === null) {
          accumulatedDeviceRotation.current = deviceAngle;
        } else {
          let delta = deviceAngle - previousAngle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          accumulatedDeviceRotation.current += delta;
        }

        lastDeviceAngle.current = deviceAngle;
        const nextRotation = accumulatedDeviceRotation.current;
        if (Math.abs(nextRotation - renderedDeviceRotation.current) < ORIENTATION_DEAD_ZONE_DEGREES) return;

        renderedDeviceRotation.current = nextRotation;
        deviceRotation.set(
          reduceMotion
            ? nextRotation
            : withTiming(nextRotation, { duration: ORIENTATION_ROTATION_DURATION_MS, easing: EASE_OUT }),
        );
      });
    });

    return () => {
      active = false;
      subscription?.remove();
      cancelAnimation(deviceRotation);
    };
  }, [deviceRotation, followDeviceOrientation, reduceMotion]);

  const handlePressIn = useCallback(() => {
    void haptics.impact();
    if (resumeBlinkTimer.current) clearTimeout(resumeBlinkTimer.current);
    stopMarkAnimation();
    markScaleY.set(1);
    if (!reduceMotion) {
      markScaleY.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(1.08, { duration: PRESS_DURATION_MS / 2, easing: EASE_OUT }),
          withTiming(1, { duration: PRESS_DURATION_MS / 2, easing: EASE_OUT }),
        ),
      );
    }
    resumeBlinkTimer.current = setTimeout(startIdleBlink, PRESS_DURATION_MS);
  }, [markScaleY, reduceMotion, startIdleBlink, stopMarkAnimation]);

  const markAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: markScaleY.get() }] }));
  const deviceRotationAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${deviceRotation.get()}deg` }],
  }));

  return { deviceRotationAnimatedStyle, handlePressIn, markAnimatedStyle };
}
