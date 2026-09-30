# Local Android APK

Base: 8078d11d399f635627a2e8c4ed12a69d6aeec471. Android package: dev.danlab.danidex.mobile.

Requirements: Node 24+, Bun 1.4.0, JDK 17, Android SDK API 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1. No EAS account or paid service is needed.

From the repository root, install scoped dependencies with `bun install --filter '@dani-dex/mobile' --ignore-scripts --frozen-lockfile`, then from apps/mobile run `bun run android:apk:local`. Native android/ is generated, not committed. The expected output is android/app/build/outputs/apk/release/app-release.apk. This release-mode test APK uses the generated debug signing key, not a store distribution key. Default ABIs are arm64-v8a and x86_64; use APK_ABIS=x86_64 for emulator-only proof.

On memory-limited hosts, cap both Gradle/Kotlin and CMake/Ninja concurrency. Gradle --max-workers=1 does not limit Ninja. The initial 2 GB host exhausted memory with default native parallelism; locally wrapping SDK Ninja with -j1 allowed C++ compilation to advance. That host-only workaround is not a repository or SDK requirement on larger machines.

Hosted Expo updates are disabled: the previous project/update UUID was not verified as Dan Lab owned. The four-color robot poses replace generated blob avatars and photo rendering at the shared avatar/picker boundary. Static baked poses do not prove live 3D motion.

Packaging and consumer functionality are separate gates. Account/team origins are intentionally null and no live pairing endpoint is verified. Desktop pairing and real chat are BLOCKED. Do not substitute upstream endpoints or fake replies. APK build, installation, native screens and video must be verified before calling the Android phase complete.

## CI candidate (not run)

.github/workflows/android-apk.yml is a reviewed-head packaging candidate for a standard ubuntu-24.04 public-repository runner. It installs the exact NDK/CMake versions and rebuilds Hermes output, checks APK package/signature and retains an artifact. It does not release, publish an Expo update, connect a backend, or prove installation. The APK is debug-key-signed even though its JS/native build mode is release.

As of September 30, 7:35 PM IST, the 2 GB local host compiled all x86_64 C++ layers but failed react-native-screens Kotlin compilation with Java heap space at a 1.1 GB heap. The candidate CI host has more RAM; its build and timings remain untested. Branch/PR upload still needs owner permission under the push freeze. Native emulator launch/screens/video are a separate remaining acceptance gate, not implied by an APK artifact.
