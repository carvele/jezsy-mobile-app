const { withDangerousMod, withProjectBuildGradle, withAppBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KOTLIN_GARMENT_MANAGER_SOURCE = `package com.jezsy.mobileapp.sceneview

import android.graphics.Color
import com.google.android.filament.Engine
import com.google.android.filament.MaterialInstance
import com.google.android.filament.TransformManager
import com.google.android.filament.gltfio.Animator
import com.google.android.filament.gltfio.FilamentAsset
import io.github.sceneview.node.ModelNode
import java.util.concurrent.ConcurrentHashMap

/**
 * SceneViewGarmentManager
 *
 * Native Kotlin extension for SceneView / Filament:
 * 1. True per-joint skeletal retargeting via Filament TransformManager and Animator.
 * 2. True material-level variant recoloring via MaterialInstance baseColorFactor,
 *    preserving metallic, roughness, and normal map textures.
 */
class SceneViewGarmentManager {

    private val cachedBoneEntities = ConcurrentHashMap<String, Int>()
    private val cachedFabricMaterials = ConcurrentHashMap<String, MaterialInstance>()
    private var isInitialized = false

    /**
     * Resolves and caches Filament skeletal entities once on model load.
     * Prevents per-frame string search in the scene graph.
     */
    fun resolveAndCacheBonesOnce(asset: FilamentAsset, boneMap: Map<String, String>) {
        cachedBoneEntities.clear()
        for ((canonical, authored) in boneMap) {
            val entity = asset.getFirstEntityByName(authored)
            if (entity != 0) {
                cachedBoneEntities[canonical] = entity
                cachedBoneEntities[authored] = entity
            }
        }
        isInitialized = true
    }

    /**
     * Applies per-frame 4x4 transform matrices to cached bone entities
     * and triggers Filament hardware skinning update.
     */
    fun applyPerFrameBoneMatrices(
        transformManager: TransformManager,
        animator: Animator,
        matrices: Map<String, FloatArray>
    ) {
        if (!isInitialized || matrices.isEmpty()) return

        transformManager.openLocalTransformTransaction()
        try {
            for ((boneName, matrix) in matrices) {
                val entity = cachedBoneEntities[boneName] ?: continue
                if (matrix.size == 16) {
                    transformManager.setTransform(entity, matrix)
                }
            }
        } finally {
            transformManager.commitLocalTransformTransaction()
        }

        // Commit vertex skinning buffer update
        animator.updateBoneMatrices()
    }

    /**
     * Applies variant hex color to the fabric MaterialInstance's baseColorFactor,
     * preserving roughness, metallic, normal, and ambient occlusion textures.
     */
    fun applyFabricMaterialRecolor(
        asset: FilamentAsset,
        hexColor: String,
        fabricMaterialName: String?
    ): Boolean {
        return try {
            val colorInt = Color.parseColor(hexColor)
            val r = Color.red(colorInt) / 255.0f
            val g = Color.green(colorInt) / 255.0f
            val b = Color.blue(colorInt) / 255.0f
            val a = 1.0f

            val materialInstances = asset.instance?.materialInstances ?: emptyArray()
            var applied = false

            for (mat in materialInstances) {
                val name = mat.name ?: ""
                val isTarget = if (!fabricMaterialName.isNullOrEmpty()) {
                    name.equals(fabricMaterialName, ignoreCase = true)
                } else {
                    // Match fabric, avoid trim/zippers/buttons
                    name.contains("fabric", ignoreCase = true) ||
                    name.contains("cloth", ignoreCase = true) ||
                    name.contains("body", ignoreCase = true) ||
                    name.contains("shirt", ignoreCase = true)
                }

                if (isTarget) {
                    mat.setParameter("baseColorFactor", r, g, b, a)
                    applied = true
                }
            }
            applied
        } catch (e: Exception) {
            false
        }
    }

    fun clear() {
        cachedBoneEntities.clear()
        cachedFabricMaterials.clear()
        isInitialized = false
    }
}
`;

/**
 * Expo Config Plugin ensuring SceneViewGarmentManager native Kotlin file
 * is written to android/app/src/main/java on expo prebuild and root build.gradle
 * has compose-compiler-gradle-plugin and NDK pin configured.
 */
const withSceneViewRetargeter = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidAppDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'jezsy',
        'mobileapp',
        'sceneview'
      );

      if (fs.existsSync(path.join(projectRoot, 'android'))) {
        fs.mkdirSync(androidAppDir, { recursive: true });
        const targetFile = path.join(androidAppDir, 'SceneViewGarmentManager.kt');
        fs.writeFileSync(targetFile, KOTLIN_GARMENT_MANAGER_SOURCE, 'utf8');

        // Ensure local.properties points to local Android SDK if not present
        const localPropsPath = path.join(projectRoot, 'android', 'local.properties');
        if (!fs.existsSync(localPropsPath)) {
          fs.writeFileSync(localPropsPath, 'sdk.dir=C\\\\:\\\\Users\\\\jhosu\\\\AppData\\\\Local\\\\Android\\\\Sdk\\n', 'utf8');
        }
      }

      return config;
    },
  ]);

  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      if (!contents.includes('kotlin-gradle-plugin:2.2.21')) {
        contents = contents.replace(
          /classpath\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin.*['"]\)/,
          "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21')\n    classpath('org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.2.21')"
        );
      }
      if (!contents.includes('ndkVersion')) {
        contents += '\nrootProject.ext.ndkVersion = "27.0.12077973"\n';
      }
      if (!contents.includes('kotlinVersion = "2.2.21"')) {
        contents = 'rootProject.ext.kotlinVersion = "2.2.21"\n' + contents;
      }
      config.modResults.contents = contents;
    }
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      if (!contents.includes('io.github.sceneview:sceneview')) {
        contents = contents.replace(
          'dependencies {',
          'dependencies {\n    implementation("io.github.sceneview:sceneview:4.7.0")\n    implementation("com.google.android.filament:filament-android:1.71.0")\n    implementation("com.google.android.filament:gltfio-android:1.71.0")'
        );
      }
      config.modResults.contents = contents;
    }
    return config;
  });

  return config;
};

module.exports = withSceneViewRetargeter;
