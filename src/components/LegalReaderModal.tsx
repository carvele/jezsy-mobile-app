import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { MarkdownViewer } from './MarkdownViewer';
import { legalService } from '../services/legalService';

const FALLBACK_TERMS = `# Terms of Service
Welcome to JezSy Boutique. By accessing or using our application and reservation services, you agree to comply with and be bound by these terms.

### 1. Boutique Reservations
- Reserved items are prepared at the boutique for personal collection.
- Customers must inspect items upon pickup.

### 2. Collection Timelines & Deadlines
- Once an order is prepared and marked **Ready for Pickup**, you must collect it within **3 Open Days**.
- If uncollected past the deadline, unpaid reservations may be cancelled and returned to inventory.

### 3. User Conduct & Security
- You agree to provide accurate information during sign-up and checkout.
- You are responsible for safeguarding your account credentials.

### 4. Updates & Modifications
- JezSy reserves the right to modify these terms and boutique policies at any time.

For assistance, reach out via in-app messages or visit our boutique.`;

const FALLBACK_PRIVACY = `# Privacy Policy
Your privacy is a priority at JezSy Boutique.

### 1. Data Collected
- Name, mobile number, and email address used for customer authentication and order fulfillment.
- Reservation histories and preferences to optimize your styling experience.

### 2. Usage of Data
- Managing orders, ready-for-pickup notifications, and in-store verification.
- We never sell or distribute your private personal information to external advertisers.

### 3. Account Rights
- You may request account or data deletion at any time in Profile settings.`;

export interface LegalReaderModalProps {
  visible: boolean;
  title?: string;
  version?: string;
  content?: string;
  documentId?: string;
  documentType?: 'terms' | 'privacy';
  initialViewed?: boolean;
  onClose: () => void;
  onViewCompleted?: () => void;
}

export const LegalReaderModal: React.FC<LegalReaderModalProps> = ({
  visible,
  title: initialTitle,
  version: initialVersion,
  content: initialContent,
  documentId: initialDocumentId,
  documentType = 'terms',
  initialViewed = false,
  onClose,
  onViewCompleted,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];

  const [loading, setLoading] = useState(!initialContent);
  const [docTitle, setDocTitle] = useState(
    initialTitle || (documentType === 'privacy' ? 'Privacy Policy' : 'Terms of Service')
  );
  const [docVersion, setDocVersion] = useState(initialVersion || '');
  const [docContent, setDocContent] = useState(initialContent || '');
  const [activeDocId, setActiveDocId] = useState(initialDocumentId || '');

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(initialViewed);
  const [isRecording, setIsRecording] = useState(false);
  const recordedRef = useRef(initialViewed);

  // Sync props if provided externally
  useEffect(() => {
    if (initialContent) {
      setDocContent(initialContent);
      setLoading(false);
    }
    if (initialTitle) setDocTitle(initialTitle);
    if (initialVersion) setDocVersion(initialVersion);
    if (initialDocumentId) setActiveDocId(initialDocumentId);
  }, [initialContent, initialTitle, initialVersion, initialDocumentId]);

  // If content is not provided externally, load the active document from DB
  useEffect(() => {
    if (!visible || initialContent) return;

    let isMounted = true;
    setLoading(true);

    (async () => {
      try {
        const doc = await legalService.getActiveDocument(documentType);
        if (!isMounted) return;
        if (doc) {
          setDocTitle(doc.title || (documentType === 'privacy' ? 'Privacy Policy' : 'Terms of Service'));
          setDocVersion(doc.version || '');
          setDocContent(doc.content_markdown || '');
          setActiveDocId(doc.id || '');
        } else {
          setDocContent(documentType === 'privacy' ? FALLBACK_PRIVACY : FALLBACK_TERMS);
        }
      } catch (err) {
        console.warn(`[LegalReaderModal] Error loading ${documentType} document:`, err);
        if (isMounted) {
          setDocContent(documentType === 'privacy' ? FALLBACK_PRIVACY : FALLBACK_TERMS);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [visible, documentType, initialContent]);

  useEffect(() => {
    if (initialViewed) {
      setHasScrolledToBottom(true);
      recordedRef.current = true;
    } else {
      setHasScrolledToBottom(false);
      recordedRef.current = false;
    }
  }, [initialViewed, visible]);

  const recordView = async () => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    onViewCompleted?.();

    if (activeDocId) {
      setIsRecording(true);
      try {
        await legalService.recordLegalDocumentView(activeDocId);
      } catch (err) {
        // Safe fallback: Unauthenticated callers (e.g. signup flow) cannot write authenticated audit rows.
        // Client-side view completion is preserved.
        console.warn('[LegalReaderModal] Could not record server view proof:', err);
      } finally {
        setIsRecording(false);
      }
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Check if scrolled near the bottom (within 60px)
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 60;
    if (isAtBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
      recordView();
    }
  };

  const handleContentSizeChange = (_w: number, contentHeight: number) => {
    // If the content is short enough that it fits without scrolling, mark viewed automatically
    if (contentHeight > 0 && contentHeight < 380 && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
      recordView();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{docTitle}</Text>
            {docVersion ? (
              <Text style={[styles.headerVersion, { color: colors.secondaryText }]}>
                Version {docVersion}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.surface ?? 'transparent' }]}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close legal reader"
          >
            <IconSymbol name="xmark" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
          >
            <MarkdownViewer content={docContent} />

            <View style={[styles.readIndicatorContainer, { borderTopColor: colors.border }]}>
              {hasScrolledToBottom ? (
                <View style={styles.viewedBadge}>
                  <IconSymbol name="checkmark.circle.fill" size={18} color="#10B981" />
                  <Text style={styles.viewedBadgeText}>
                    {isRecording ? 'Verifying read proof...' : 'Document reviewed in full'}
                  </Text>
                </View>
              ) : (
                <View style={styles.scrollPrompt}>
                  <IconSymbol name="arrow.down" size={18} color={colors.secondaryText} />
                  <Text style={[styles.scrollPromptText, { color: colors.secondaryText }]}>
                    Please scroll to the bottom to confirm you have read this document
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.doneBtn,
              { backgroundColor: hasScrolledToBottom ? colors.tint : colors.border },
            ]}
            onPress={hasScrolledToBottom ? onClose : undefined}
            disabled={!hasScrolledToBottom}
            accessibilityRole="button"
            accessibilityLabel={hasScrolledToBottom ? 'Done reading document' : 'Scroll to bottom to review'}
            accessibilityState={{ disabled: !hasScrolledToBottom }}
          >
            <Text
              style={[
                styles.doneBtnText,
                { color: hasScrolledToBottom ? '#FFFFFF' : colors.secondaryText },
              ]}
            >
              {hasScrolledToBottom ? 'Done' : 'Scroll to Bottom to Review'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerVersion: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
  },
  readIndicatorContainer: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  viewedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  viewedBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10B981',
  },
  scrollPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  scrollPromptText: {
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneBtn: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
