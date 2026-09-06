module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Filament needs nested worklets; preserve the existing camera and Reanimated plugin order.
    plugins: [
      ['react-native-worklets-core/plugin', { processNestedWorklets: true }],
      'react-native-reanimated/plugin',
    ],
  };
};
