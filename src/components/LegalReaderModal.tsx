import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MarkdownViewer } from './MarkdownViewer';
import { legalService } from '../services/legalService';

interface LegalReaderModalProps {
  visible: boolean;
  title: string;
  version?: string;
  content: string;
  documentId: string;
  initialViewed?: boolean;
  onClose: () => void;
  onViewCompleted?: () => void;
}

export const LegalReaderModal: React.FC<LegalReaderModalProps> = ({
  visible,
  title,
  version,
  content,
  documentId,
  initialViewed = false,
  onClose,
  onViewCompleted,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(initialViewed);
  const [isRecording, setIsRecording] = useState(false);
  const recordedRef = useRef(initialViewed);

  useEffect(() => {
    if (initialViewed) {
      setHasScrolledToBottom(true);
      recordedRef.current = true;
    }
  }, [initialViewed]);

  const recordView = async () => {
    if (recordedRef.current || !documentId) return;
    recordedRef.current = true;
    setIsRecording(true);
    try {
      await legalService.recordLegalDocumentView(documentId);
      onViewCompleted?.();
    } catch (err) {
      console.warn('[LegalReaderModal] Failed to record view evidence:', err);
      // Allow retry if recording failed
      recordedRef.current = false;
    } finally {
      setIsRecording(false);
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Check if scrolled near the bottom (within 50px)
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    if (isAtBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
      recordView();
    }
  };

  const handleContentSizeChange = (_w: number, contentHeight: number) => {
    // If the content is short enough that it fits without scrolling, mark viewed automatically
    if (contentHeight > 0 && contentHeight < 400 && !hasScrolledToBottom) {
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
            <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
            {version ? (
              <Text style={[styles.headerVersion, { color: colors.secondaryText }]}>
                Version {version}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close legal reader"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={handleContentSizeChange}
        >
          <MarkdownViewer content={content} />

          <View style={[styles.readIndicatorContainer, { borderTopColor: colors.border }]}>
            {hasScrolledToBottom ? (
              <View style={styles.viewedBadge}>
                <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                <Text style={styles.viewedBadgeText}>
                  {isRecording ? 'Verifying read proof...' : 'Document reviewed in full'}
                </Text>
              </View>
            ) : (
              <View style={styles.scrollPrompt}>
                <Ionicons name="arrow-down-circle-outline" size={18} color={colors.secondaryText} />
                <Text style={[styles.scrollPromptText, { color: colors.secondaryText }]}>
                  Please scroll to the bottom to confirm you have read this document
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.doneBtn,
              { backgroundColor: hasScrolledToBottom ? colors.tint : colors.border },
            ]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done reading document"
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
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleContainer: {
    flex: 1,
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
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  readIndicatorContainer: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
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
