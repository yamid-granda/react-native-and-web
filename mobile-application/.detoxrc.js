/**
 * Detox needs a real built native app — Expo Go isn't enough. Run
 * `pnpm prebuild` once first (generates ios/ and android/, gitignored,
 * via expo-detox-config-plugin), then check the generated
 * ios/<name>.xcworkspace and its scheme name and update the
 * `build`/`binaryPath` entries below to match if they differ from the
 * defaults assumed here.
 *
 * @type {Detox.DetoxConfig}
 */
module.exports = {
  testRunner: {
    args: {
      $0: "jest",
      config: "e2e/jest.config.js",
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    "ios.debug": {
      type: "ios.app",
      binaryPath: "ios/build/Build/Products/Debug-iphonesimulator/mobileapplication.app",
      build:
        "xcodebuild -workspace ios/mobileapplication.xcworkspace -scheme mobileapplication " +
        "-configuration Debug -sdk iphonesimulator -derivedDataPath ios/build",
    },
    "android.debug": {
      type: "android.apk",
      binaryPath: "android/app/build/outputs/apk/debug/app-debug.apk",
      build:
        "cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..",
    },
  },
  devices: {
    simulator: {
      type: "ios.simulator",
      device: { type: "iPhone 16" },
    },
    emulator: {
      type: "android.emulator",
      device: { avdName: "Pixel_7_API_34" },
    },
  },
  configurations: {
    "ios.debug": {
      device: "simulator",
      app: "ios.debug",
    },
    "android.debug": {
      device: "emulator",
      app: "android.debug",
    },
  },
};
