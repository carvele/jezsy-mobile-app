import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ConsentModal } from "@/src/components/ConsentModal";

export default function BodyScanScreen() {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const params = useLocalSearchParams();

  const height = params.height ? parseFloat(params.height as string) : null;
  const weight = params.weight ? parseFloat(params.weight as string) : null;

  const [showConsent, setShowConsent] = useState(true);
  const [consentGranted, setConsentGranted] = useState(false);

  useEffect(() => {
    if (!height || !weight) {
      Alert.alert("Missing Info", "Please enter your height and weight first.");
      router.back();
    }
  }, [height, weight, router]);

  const handleConsentAccept = async () => {
    setShowConsent(false);
    setConsentGranted(true);
  };

  const handleConsentDecline = () => {
    setShowConsent(false);
    router.back();
  };

  const returnToManualMeasurements = () => {
    router.replace("/profile/measurements");
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

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <IconSymbol name="xmark" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Body Scan</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Auto-scan is currently unavailable</Text>
        <Text style={styles.cardBody}>
          This build does not yet include a working native pose model, so body
          measurements must be entered manually for now.
        </Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={returnToManualMeasurements}
        >
          <Text style={styles.actionText}>Continue to Manual Measurements</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  card: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  cardBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#F5C96C",
  },
  actionText: {
    color: "#0D0D0D",
    fontSize: 14,
    fontWeight: "700",
  },
});
