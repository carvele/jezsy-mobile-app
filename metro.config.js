const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the BlazePose TFLite model as a binary asset (react-native-fast-tflite
// loads it via require('assets/models/*.tflite')).
config.resolver.assetExts.push('tflite');

module.exports = config;
