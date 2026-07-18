const { withAndroidManifest } = require('@expo/config-plugins');

const withMlkitManifestFix = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;

    // 1. Ensure tools namespace exists on the root manifest element
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // 2. Find or create the meta-data entry in application
    const app = androidManifest.manifest.application[0];
    if (!app['meta-data']) {
      app['meta-data'] = [];
    }

    const metaDataName = 'com.google.mlkit.vision.DEPENDENCIES';
    const targetValue = 'subject_segment,barcode_ui';

    let found = false;
    for (const item of app['meta-data']) {
      if (item.$['android:name'] === metaDataName) {
        item.$['android:value'] = targetValue;
        item.$['tools:replace'] = 'android:value';
        found = true;
        break;
      }
    }

    if (!found) {
      app['meta-data'].push({
        $: {
          'android:name': metaDataName,
          'android:value': targetValue,
          'tools:replace': 'android:value',
        },
      });
    }

    return config;
  });
};

module.exports = withMlkitManifestFix;
