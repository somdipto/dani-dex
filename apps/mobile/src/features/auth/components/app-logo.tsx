import { DANI_MARK_PATH } from "@dani-dex/brand/dani-mark";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";

import { type AppLogoAnimation, useAppLogoMotion } from "@/features/auth/components/use-app-logo-motion";

export type { AppLogoAnimation } from "@/features/auth/components/use-app-logo-motion";

export interface AppLogoProps {
  animation?: AppLogoAnimation;
  followDeviceOrientation?: boolean;
  interactive?: boolean;
  size?: number;
}

const VIEWBOX_SIZE = 240;
function resolveColor(value: string | number | undefined, fallback: string): string {
  return String(value ?? fallback);
}

export function AppLogo({
  animation = "none",
  followDeviceOrientation = false,
  interactive = false,
  size = VIEWBOX_SIZE,
}: AppLogoProps) {
  const backgroundColor = resolveColor(useCSSVariable("--dani-dex-logo-production"), "#ffffff");
  const markColor = resolveColor(useCSSVariable("--dani-dex-logo-eye"), "#000000");
  const { deviceRotationAnimatedStyle, handlePressIn, markAnimatedStyle } = useAppLogoMotion({
    animation,
    followDeviceOrientation,
  });
  const logo = (
    <Animated.View style={[{ height: size, transformOrigin: "center", width: size }, deviceRotationAnimatedStyle]}>
      <View
        style={{ height: size, width: size }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
          <Rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} rx={50} ry={50} fill={backgroundColor} />
        </Svg>

        <Animated.View
          pointerEvents="none"
          style={[{ height: size, width: size, position: "absolute" }, markAnimatedStyle]}
        >
          <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
            <Path d={DANI_MARK_PATH} fill={markColor} fillRule="evenodd" />
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );

  if (!interactive) return logo;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Animate Dani-Dex logo"
      accessibilityHint="Makes the logo wink"
      onPressIn={handlePressIn}
      pressRetentionOffset={12}
    >
      {logo}
    </Pressable>
  );
}
