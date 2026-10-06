import type { AvatarHue } from "@dani-dex/contracts/ipc";
import { Button } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ROBOT_HUE_OPTIONS } from "../model/robot-appearance";
import type { AgentPhotoProps } from "./agent-photo";
import { BloubAvatarPreview } from "./bloub-avatar";
import { RobotAvatar } from "./robot-avatar";

interface AgentAppearancePickerProps extends AgentPhotoProps {
  seed: string;
  hue: AvatarHue | null;
  name: string;
  nameField: ReactNode;
  photoField?: ReactNode;
  showFaces?: boolean;
  disabled: boolean;
  onSeedChange: (seed: string) => void;
  onHueChange: (hue: AvatarHue | null) => void;
}

export function AgentAppearancePicker({
  seed,
  hue,
  name,
  nameField,
  photoField,
  agentId,
  serverId,
  imageUrl,
  disabled,
  onHueChange,
}: AgentAppearancePickerProps) {
  return (
    <View className="gap-4">
      <View
        className="items-center gap-2"
        accessible
        accessibilityLabel={`Robot preview for ${name.trim() || "New agent"}`}
      >
        <BloubAvatarPreview
          agentId={agentId}
          serverId={serverId}
          imageUrl={imageUrl}
          seed={seed}
          hue={hue}
          size={144}
        />
      </View>
      {nameField}
      {photoField}
      <View
        className="flex-row flex-wrap justify-center gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Robot color"
      >
        {ROBOT_HUE_OPTIONS.map((option) => (
          <Button
            key={option.hue}
            isIconOnly
            variant={hue === option.hue ? "secondary" : "ghost"}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: hue === option.hue, disabled }}
            isDisabled={disabled}
            onPress={() => onHueChange(option.hue)}
          >
            <RobotAvatar color={option.color} size={48} />
          </Button>
        ))}
        <View className="w-full items-center">
          <Button
            variant="ghost"
            size="sm"
            accessibilityRole="radio"
            accessibilityLabel="Automatic"
            accessibilityState={{ checked: hue === null, disabled }}
            isDisabled={disabled}
            onPress={() => onHueChange(null)}
          >
            <Button.Label>{hue === null ? "✓ Automatic" : "Automatic"}</Button.Label>
          </Button>
        </View>
      </View>
    </View>
  );
}
