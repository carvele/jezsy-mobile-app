// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    // React Compiler is intentionally not enabled in app.config.js. SDK 57's
    // lint preset exposes its diagnostics regardless, but this established app
    // has not yet been migrated to the compiler's ref/effect constraints.
    // Keep the existing lint gate stable; enable these while doing a dedicated
    // React Compiler migration rather than mixing it into the SDK upgrade.
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
