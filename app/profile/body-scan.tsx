import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

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
  const [countdown, setCountdown] = useState<number | null>(null);
  
  const cameraRef = useRef<CameraView>(null);
  const countdownTimerRef = useRef<any>(null);
  const lastSpokenRef = useRef<string>("");

  useEffect(() => {
    if (!height || !weight) {
      Alert.alert("Missing Info", "Please enter your height and weight first.");
      router.back();
    }
  }, [height, weight, router]);

  useEffect(() => {
    if (consentGranted && permission?.granted) {
      Speech.speak("Please stand about 2 meters from your device.", {
        onDone: () => {
          lastSpokenRef.current = "intro";
        }
      });
    }
    
    return () => {
      Speech.stop();
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    };
  }, [consentGranted, permission]);

  const speakIfNotActive = (text: string) => {
    if (lastSpokenRef.current === text || countdown !== null) return;
    Speech.speak(text);
    lastSpokenRef.current = text;
  };

  const startCountdown = () => {
    Speech.stop();
    Speech.speak("Perfect, scanning in 3... 2... 1...");
    setCountdown(3);
    
    let counter = 3;
    countdownTimerRef.current = setInterval(() => {
      counter -= 1;
      setCountdown(counter);
      if (counter <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        takePicture();
      }
    }, 1000);
  };

  const stopCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (countdown !== null) {
      Speech.stop();
      setCountdown(null);
      lastSpokenRef.current = "";
    }
  };

  const handleGuideState = (state: 'tilt_down' | 'tilt_up' | 'hold_steady') => {
    if (isProcessing) return;

    if (state === 'tilt_down') {
      stopCountdown();
      speakIfNotActive("Tilt phone down");
    } else if (state === 'tilt_up') {
      stopCountdown();
      speakIfNotActive("Tilt phone up");
    } else if (state === 'hold_steady') {
      if (countdown === null) {
        startCountdown();
      }
    }
  };

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
    if (!cameraRef.current || isProcessing) return;
    setIsProcessing(true);
    Speech.speak("Got it! Processing your measurements...");
    
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
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
      Speech.speak("Oops, something went wrong. Please try again.");
      setCountdown(null);
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

  // Determine outline color based on state
  let outlineColor = 'rgba(255,255,255,0.4)';
  if (isProcessing) {
    outlineColor = '#00FF00';
  } else if (countdown !== null) {
    outlineColor = '#00FF00';
  } else if (!isTiltValid) {
    outlineColor = '#FF3B30'; // Red when invalid
  } else {
    outlineColor = '#FFCC00'; // Yellow when valid but not yet countdown (should be brief)
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} ref={cameraRef} facing="front" />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { Speech.stop(); router.back(); }} style={styles.iconBtn}>
            <IconSymbol name="chevron.left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Position Your Body</Text>
          <TouchableOpacity onPress={() => { Speech.stop(); router.replace({ pathname: "/profile/measurements", params: { height, weight } }); }} style={styles.iconBtnText}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Device Orientation Guide */}
        <TiltGuide onTiltValid={setIsTiltValid} onGuideState={handleGuideState} />

        {/* Silhouette Overlay */}
        <View style={styles.silhouetteContainer} pointerEvents="none">
          <View style={[styles.headOutline, { borderColor: outlineColor }]} />
          <View style={[styles.shouldersOutline, { borderColor: outlineColor }]} />
          <View style={[styles.torsoOutline, { borderColor: outlineColor }]} />
        </View>

        {/* Status/Guidance Text */}
        <View style={styles.controls}>
          {isProcessing ? (
            <View style={styles.processingBadge}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.processingText}>Processing Scan...</Text>
            </View>
          ) : countdown !== null ? (
            <View style={styles.countdownBadge}>
              <Text style={styles.countdownText}>Scanning in {countdown}...</Text>
            </View>
          ) : !isTiltValid ? (
            <Text style={styles.warningText}>Please follow voice instructions</Text>
          ) : null}
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
    borderWidth: 2, borderRadius: 50,
    borderStyle: 'dashed', marginBottom: 10,
  },
  shouldersOutline: {
    width: 220, height: 60,
    borderWidth: 2, borderRadius: 30,
    borderStyle: 'dashed', borderBottomWidth: 0,
  },
  torsoOutline: {
    width: 180, height: 250,
    borderWidth: 2, borderRadius: 20,
    borderStyle: 'dashed', borderTopWidth: 0,
  },
  controls: {
    alignItems: 'center',
    paddingBottom: 60,
    zIndex: 20,
  },
  warningText: {
    color: '#FFCC00',
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 16,
    fontSize: 16,
  },
  countdownBadge: {
    backgroundColor: 'rgba(0,255,0,0.8)',
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 24,
  },
  countdownText: { color: '#000', fontSize: 20, fontWeight: '700' },
  processingBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, gap: 12,
  },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
