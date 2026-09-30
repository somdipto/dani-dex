import { Fragment, type PropsWithChildren, useEffect, useRef } from "react";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { RobotAvatar } from "@/features/agents/components/robot-avatar";

// Kept as a compatibility boundary for the root layout. Robot stills need no shared shape clock.
export function BloubAnimationProvider({ children }: PropsWithChildren) {
  return <Fragment>{children}</Fragment>;
}

export function BloubLoader({
  label,
  active = true,
  visible = true,
  onExitComplete,
}: {
  label: string;
  active?: boolean;
  visible?: boolean;
  onExitComplete?: () => void;
}) {
  const opacity = useSharedValue(visible ? 1 : 0);
  const revision = useRef(0);
  const onExit = useRef(onExitComplete);
  onExit.current = onExitComplete;
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  useEffect(() => {
    const current = ++revision.current;
    let done = false;
    const finish = () => {
      if (done || revision.current !== current) return;
      done = true;
      onExit.current?.();
    };
    opacity.set(
      withTiming(visible ? 1 : 0, { duration: 180, reduceMotion: ReduceMotion.System }, (finished) => {
        if (finished && !visible) scheduleOnRN(finish);
      }),
    );
    // A paused UI animation must not leave the root overlay covering the app forever.
    const deadline = visible ? undefined : setTimeout(finish, 500);
    return () => {
      revision.current += 1;
      clearTimeout(deadline);
      cancelAnimation(opacity);
    };
  }, [opacity, visible]);
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: active }}
      style={style}
    >
      <RobotAvatar color="violet" state={active ? "working" : "idle"} size={112} />
    </Animated.View>
  );
}
