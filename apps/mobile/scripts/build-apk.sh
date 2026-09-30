#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with API 36, build-tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1}"
command -v java >/dev/null
command -v bun >/dev/null
bun run setup:skia
CI=1 bunx expo prebuild --platform android --no-install
# Standalone release-mode test APK, signed only by Expo's generated debug key.
# Not a store release, not EAS, and not dependent on Metro after installation.
GRADLE_OPTS="${GRADLE_OPTS:--Xmx448m -XX:MaxMetaspaceSize=320m -Dorg.gradle.daemon=false}" \
android/gradlew -p android assembleRelease --no-daemon --max-workers=1 \
  -Dorg.gradle.jvmargs= -Dorg.gradle.parallel=false \
  -Pkotlin.compiler.execution.strategy=in-process \
  -PreactNativeArchitectures="${APK_ABIS:-arm64-v8a,x86_64}"
