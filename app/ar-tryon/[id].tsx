import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

type Product = Database['public']['Tables']['products']['Row'];

export default function ARTryOnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [permission, requestPermission] = useCameraPermissions();
  
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setProduct(data);
      } catch (err) {
        console.error('Error fetching product for AR Try-On:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={{ color: colors.text, marginTop: 16 }}>Loading 3D Model...</Text>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toggleMode = async () => {
    if (mode === '3d') {
      if (!permission?.granted) {
        const { granted } = await requestPermission();
        if (!granted) {
          Alert.alert("Camera Required", "Camera access is needed for the 2D overlay.");
          return;
        }
      }
      setMode('2d');
    } else {
      setMode('3d');
    }
  };

  // Fallback 3D model if product doesn't have one
  const modelUrl = product.model_3d_url || 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
  // Attempt to map to USDZ for iOS QuickLook if it's our fallback or if we have a simple mapping rule
  const iosModelUrl = modelUrl.replace('.glb', '.usdz');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; background-color: #0D0D0D; overflow: hidden; }
          model-viewer {
            width: 100%;
            height: 100%;
            --poster-color: transparent;
            background-color: #0D0D0D;
          }
          #ar-button {
            position: absolute;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #C9A96E;
            color: #0D0D0D;
            padding: 16px 32px;
            border-radius: 28px;
            font-size: 16px;
            font-weight: 700;
            border: none;
            box-shadow: 0 4px 8px rgba(201, 169, 110, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
        </style>
        <!-- Import the component -->
        <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
      </head>
      <body>
        <model-viewer
          src="${modelUrl}"
          ios-src="${iosModelUrl}"
          ar
          ar-modes="webxr scene-viewer quick-look"
          camera-controls
          auto-rotate
          rotation-per-second="30deg"
          shadow-intensity="1"
          environment-image="neutral"
          alt="A 3D model of ${product.name.replace(/"/g, '&quot;')}">
          <button slot="ar-button" id="ar-button">
            View in your space (AR)
          </button>
        </model-viewer>
      </body>
    </html>
  `;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>AR Try-On</Text>
        
        <TouchableOpacity onPress={toggleMode} style={styles.modeToggle}>
          <Text style={styles.modeToggleText}>{mode === '3d' ? 'Use 2D Overlay' : 'Use 3D Model'}</Text>
        </TouchableOpacity>
      </View>

      {mode === '3d' ? (
        <View style={styles.webviewContainer}>
          <WebView
          originWhitelist={['*']}
          source={{ html: htmlContent }}
          style={styles.webview}
          scrollEnabled={false}
          bounces={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          allowsInlineMediaPlayback={true}
        />
        
        {!product.model_3d_url && (
          <View style={styles.demoWarning}>
            <Text style={styles.demoWarningText}>Showing Demo Model</Text>
          </View>
        )}
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          <CameraView style={styles.camera} facing="front" />
          <View style={styles.overlayContainer} pointerEvents="none">
            <Image 
              source={{ uri: product.image_url || '' }} 
              style={styles.overlayImage} 
              contentFit="contain" 
            />
            <View style={styles.overlayGuide}>
              <Text style={styles.overlayGuideText}>Align your body with the item</Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    zIndex: 10,
  },
  backButton: {
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  demoWarning: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: 'rgba(239, 71, 111, 0.8)', // red warning
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  demoWarningText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#C9A96E',
    borderRadius: 12,
  },
  modeToggleText: {
    color: '#0D0D0D',
    fontWeight: '700',
    fontSize: 12,
  },
  camera: {
    flex: 1,
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  overlayImage: {
    width: '80%',
    height: '60%',
    opacity: 0.85,
  },
  overlayGuide: {
    position: 'absolute',
    bottom: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  overlayGuideText: {
    color: '#FFF',
    fontWeight: '600',
  }
});
