import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from 'expo-camera';

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ConsentModal } from "@/src/components/ConsentModal";
import { TiltGuide } from "@/src/components/TiltGuide";

export default function BodyScanScreen() {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const params = useLocalSearchParams();

  const height = params.height ? parseFloat(params.height as string) : null;
  const weight = params.weight ? parseFloat(params.weight as string) : null;

  const [showConsent, setShowConsent] = useState(true);
  const [consentGranted, setConsentGranted] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [isTiltValid, setIsTiltValid] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (!height || !weight) {
      Alert.alert("Missing Info", "Please enter your height and weight first.");
      router.back();
    }
  }, [height, weight, router]);

  const handleConsentAccept = async () => {
    setShowConsent(false);
    setConsentGranted(true);
    if (!permission?.granted) {
      await requestPermission();
    }
  };

  const handleConsentDecline = () => {
    setShowConsent(false);
    router.back();
  };

  const takePicture = async () => {
    if (!cameraRef.current || !isTiltValid) return;
    setIsProcessing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      // In a real app with BlazePose TFLite, we'd pass this photo to the ML model here.
      // For now, we simulate processing and pass the image URI to the manual measurements page.
      setTimeout(() => {
        setIsProcessing(false);
        router.replace({
          pathname: "/profile/measurements",
          params: { height, weight, photoUri: photo?.uri }
        });
      }, 1500);
    } catch (e) {
      console.warn("Failed to take picture", e);
      setIsProcessing(false);
    }
  };

  if (!consentGranted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ConsentModal
          visible={showConsent}
          onAccept={handleConsentAccept}
          onDecline={handleConsentDecline}
        />
      </View>
    );
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={styles.centerCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Camera Access Required</Text>
          <Text style={[styles.cardBody, { color: colors.secondaryText }]}>
            We need camera access to perform the body scan and calculate your measurements.
          </Text>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.tint }]} onPress={requestPermission}>
            <Text style={styles.actionText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} ref={cameraRef} facing="front" />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <IconSymbol name="chevron.left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Position Your Body</Text>
          <TouchableOpacity onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight } })} style={styles.iconBtnText}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Device Orientation Guide */}
        <TiltGuide onTiltValid={setIsTiltValid} />

        {/* Silhouette Overlay */}
        <View style={styles.silhouetteContainer} pointerEvents="none">
          <View style={styles.headOutline} />
          <View style={styles.shouldersOutline} />
          <View style={styles.torsoOutline} />
        </View>

        {/* Capture Controls */}
        <View style={styles.controls}>
          {isProcessing ? (
            <View style={styles.processingBadge}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.processingText}>Processing Scan...</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.captureButton,
                !isTiltValid && styles.captureButtonDisabled
              ]}
              onPress={takePicture}
              disabled={!isTiltValid}
            >
              <View style={[styles.captureInner, !isTiltValid && styles.captureInnerDisabled]} />
            </TouchableOpacity>
          )}
          {!isTiltValid && !isProcessing && (
            <Text style={styles.warningText}>Hold phone vertically straight to scan</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  safeArea: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 20,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20,
  },
  iconBtnText: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 16,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  skipText: { color: "#fff", fontWeight: "600" },
  centerCard: {
    flex: 1, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 24,
  },
  cardTitle: { fontSize: 22, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  cardBody: { fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 24 },
  actionButton: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  actionText: { color: "#0D0D0D", fontSize: 14, fontWeight: "700" },
  silhouetteContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  headOutline: {
    width: 80, height: 100,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 50,
    borderStyle: 'dashed', marginBottom: 10,
  },
  shouldersOutline: {
    width: 220, height: 60,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 30,
    borderStyle: 'dashed', borderBottomWidth: 0,
  },
  torsoOutline: {
    width: 180, height: 250,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 20,
    borderStyle: 'dashed', borderTopWidth: 0,
  },
  controls: {
    alignItems: 'center',
    paddingBottom: 40,
    zIndex: 20,
  },
  captureButton: {
    width: 72, height: 72,
    borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureButtonDisabled: { borderColor: 'rgba(255,255,255,0.3)' },
  captureInner: {
    width: 56, height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  captureInnerDisabled: { backgroundColor: 'rgba(255,255,255,0.3)' },
  warningText: {
    color: '#FFCC00',
    marginTop: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 8,
  },
  processingBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, gap: 12,
  },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
