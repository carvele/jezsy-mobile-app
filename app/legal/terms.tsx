import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { legalService } from '@/src/services/legalService';
import { MarkdownViewer } from '@/src/components/MarkdownViewer';

export default function TermsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];

  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const doc = await legalService.getActiveDocument('terms');
        if (mounted) setDocument(doc);
      } catch (err) {
        console.error('[TermsScreen] Error loading terms:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Terms of Service</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
          {document ? (
            <>
              <View style={styles.metaBox}>
                <Text style={[styles.versionBadge, { color: colors.tint }]}>
                  Version {document.version}
                </Text>
                {document.effective_at && (
                  <Text style={[styles.effectiveDate, { color: colors.secondaryText }]}>
                    Effective: {new Date(document.effective_at).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <MarkdownViewer content={document.content_markdown} />
            </>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={48} color={colors.secondaryText} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Terms of Service</Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                Our terms of service are currently being updated by boutique management. Please check back shortly or reach out to customer support.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerRightPlaceholder: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  metaBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  versionBadge: {
    fontSize: 13,
    fontWeight: '700',
  },
  effectiveDate: {
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
});
