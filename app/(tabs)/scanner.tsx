import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  // In focus effect to reset scanned state when returning to this tab
  useEffect(() => {
    if (scanned) {
      const timeout = setTimeout(() => {
        setScanned(false);
      }, 3000); // Allow scanning again after 3 seconds
      return () => clearTimeout(timeout);
    }
  }, [scanned]);

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.text }}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.tint }]}>Scanner</Text>
        </View>
        <View style={styles.permissionContent}>
          <IconSymbol name="camera" size={80} color={colors.icon} />
          <Text style={[styles.permissionText, { color: colors.text }]}>
            We need your permission to access the camera to scan product QR codes and tags in the boutique.
          </Text>
          <TouchableOpacity 
            style={[styles.permissionButton, { backgroundColor: colors.tint }]}
            onPress={requestPermission}
          >
            <Text style={styles.permissionButtonText}>Allow Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    setScanned(true);
    console.log(`Scanned type: ${type}, data: ${data}`);
    
    // Check if it's a valid UUID (assuming product IDs are UUIDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (uuidRegex.test(data)) {
      // It's a product ID
      Alert.alert(
        'Product Found',
        'Would you like to view this product details?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
          { 
            text: 'View Product', 
            onPress: () => {
              router.navigate(`/product/${data}`);
            }
          }
        ]
      );
    } else {
      // Handle other types of QR codes or mock behavior
      Alert.alert(
        'QR Code Scanned',
        `Data: ${data}`,
        [
          { text: 'OK', onPress: () => setScanned(false) }
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "ean13", "ean8", "pdf417", "code128"],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      
      <SafeAreaView style={styles.overlayContainer} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.tint, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: {width: 1, height: 1}, textShadowRadius: 3 }]}>
            Scanner
          </Text>
        </View>

        <View style={styles.scannerOverlay}>
          <View style={styles.viewfinderContainer}>
            {/* Viewfinder corners */}
            <View style={[styles.corner, styles.topLeft, { borderColor: colors.tint }]} />
            <View style={[styles.corner, styles.topRight, { borderColor: colors.tint }]} />
            <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.tint }]} />
            <View style={[styles.corner, styles.bottomRight, { borderColor: colors.tint }]} />
            
            <View style={[styles.scanLine, { backgroundColor: colors.tint }]} />
          </View>
          
          <Text style={styles.instructionText}>
            Align the QR code or Barcode within the frame to scan
          </Text>
        </View>
      </SafeAreaView>
      
      {/* Background Dimming (excluding viewfinder area) - simplified overlay */}
      <View style={styles.dimmingOverlay} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  overlayContainer: {
    flex: 1,
    zIndex: 2,
    justifyContent: 'space-between',
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinderContainer: {
    width: 250,
    height: 250,
    position: 'relative',
    marginBottom: 40,
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 16,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 16,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 16,
  },
  scanLine: {
    position: 'absolute',
    height: 2,
    width: '100%',
    top: '50%',
    shadowColor: '#C9A96E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
    maxWidth: '80%',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  permissionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 40,
    lineHeight: 24,
  },
  permissionButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 28,
  },
  permissionButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
  dimmingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 1,
  },
});

