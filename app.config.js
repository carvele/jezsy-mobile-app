// Converted from a static app.json so googleServicesFile can resolve
// differently in EAS cloud builds vs. local dev: google-services.json is
// gitignored (Firebase config, kept out of source control), so EAS's
// build servers never see it unless supplied via a file-type EAS
// environment variable (GOOGLE_SERVICES_JSON). Locally, that variable
// isn't set, so this falls back to the real file already on disk. A
// static app.json can't do this branching -- JSON has no process.env.
module.exports = {
  expo: {
    name: "jezsy-mobile-app",
    slug: "jezsy-mobile-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "jezsymobileapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.jezsy.mobileapp",
      usesAppleSignIn: true,
      infoPlist: {
        NSCameraUsageDescription: "JezSy uses your camera for the virtual try-on and AR experience.",
        NSPhotoLibraryUsageDescription: "JezSy reads photos to let you upload wardrobe items.",
        NSPhotoLibraryAddUsageDescription: "JezSy saves outfit captures to your photo library.",
        NSMicrophoneUsageDescription: "JezSy uses the microphone during video-based try-on sessions.",
        NSFaceIDUsageDescription: "JezSy uses Face ID for fast, secure sign-in.",
      },
    },
    android: {
      package: "com.jezsy.mobileapp",
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      "expo-font",
      "expo-web-browser",
      "expo-notifications",
      "./plugins/withMlkitManifestFix",
      [
        "react-native-mediapipe-posedetection",
        {
          assetsPaths: ["./assets/models/"],
        },
      ],
      "@sentry/react-native/expo",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "8c74360c-1d93-4a66-b20e-5507caad75b4",
      },
    },
    owner: "carvele",
  },
};
