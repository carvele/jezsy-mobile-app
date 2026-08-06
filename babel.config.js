module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated is pinned to 3.x (see package.json) specifically because
    // react-native-vision-camera's peer dependency is react-native-worklets-core,
    // not Reanimated 4's react-native-worklets -- having both worklets runtimes
    // installed at once crashes on Android at startup with "Cannot read property
    // 'EventEmitter' of undefined" (a known, unresolved upstream conflict:
    // https://github.com/mrousavy/react-native-vision-camera/issues/3563).
    // With react-native-worklets absent, babel-preset-expo auto-injects
    // react-native-reanimated/plugin (the 3.x plugin) on its own.
    // react-native-worklets-core still needs its plugin listed explicitly.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
