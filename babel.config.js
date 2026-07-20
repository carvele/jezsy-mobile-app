module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo auto-injects react-native-worklets/plugin (Reanimated 4's
    // runtime) internally when it detects the package. react-native-worklets-core
    // (a separate runtime used by react-native-vision-camera's frame processors)
    // needs its own plugin added explicitly. Babel plugins run before presets, so
    // listing it here avoids the two worklet runtimes conflicting.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
