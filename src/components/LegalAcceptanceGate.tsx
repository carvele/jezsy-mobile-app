import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { LegalAcceptanceStatus, legalService } from '../services/legalService';
import { LegalReaderModal } from './LegalReaderModal';

interface LegalAcceptanceGateProps {
  status: LegalAcceptanceStatus | null;
  error: Error | null;
  onRetry: () => Promise<void>;
  onAccepted: () => void;
}

export const LegalAcceptanceGate: React.FC<LegalAcceptanceGateProps> = ({
  status,
  error,
  onRetry,
  onAccepted,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { signOut } = useAuth();

  const [activeReadingDoc, setActiveReadingDoc] = useState<'terms' | 'privacy' | null>(null);
  const [termsViewed, setTermsViewed] = useState(status?.terms?.is_viewed ?? false);
  const [privacyViewed, setPrivacyViewed] = useState(status?.privacy?.is_viewed ?? false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSupportNavigation = () => {
    // Navigate internally to customer support messages
    router.push('/messages' as any);
  };

  const handleAccept = async () => {
    if (!status?.terms?.document_id || !status?.privacy?.document_id) return;
    if (!termsAgreed || !privacyAgreed) return;

    setIsSubmitting(true);
    try {
      await legalService.acceptLegalDocuments(
        status.terms.document_id,
        status.privacy.document_id
      );
      onAccepted();
    } catch (err: any) {
      console.error('[LegalAcceptanceGate] Acceptance error:', err);
      Alert.alert(
        'Acceptance Error',
        err?.message || 'Could not record your acceptance. Please make sure both documents are fully reviewed and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fail-Closed Error State
  if (error || !status) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <View style={[styles.errorIconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
            <Ionicons name="shield-outline" size={44} color="#EF4444" />
          </View>

          <Text style={[styles.errorTitle, { color: colors.text }]}>
            Unable to verify Terms & Privacy status
          </Text>

          <Text style={[styles.errorDescription, { color: colors.secondaryText }]}>
            We could not securely verify your legal acceptance. To protect your account and data, normal application access remains blocked.
          </Text>

          <View style={styles.errorActions}>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: colors.tint }]}
              onPress={handleRetry}
              disabled={isRetrying}
              accessibilityRole="button"
              accessibilityLabel="Retry legal verification"
            >
              {isRetrying ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>Retry Verification</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionBtn, { borderColor: colors.border }]}
              onPress={handleSupportNavigation}
              accessibilityRole="button"
              accessibilityLabel="Contact in-app support"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
              <Text style={[styles.secondaryActionBtnText, { color: colors.text }]}>
                Contact In-App Support
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.signOutLink}
              onPress={() => signOut()}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Text style={[styles.signOutLinkText, { color: colors.secondaryText }]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const termsDoc = status.terms;
  const privacyDoc = status.privacy;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Header Branding */}
        <View style={styles.headerArea}>
          <View style={[styles.iconBadge, { backgroundColor: colors.surface }]}>
            <Ionicons name="document-text-outline" size={32} color={colors.tint} />
          </View>
          <Text style={[styles.brandLabel, { color: colors.tint }]}>JEZSY BOUTIQUE</Text>
          <Text style={[styles.mainTitle, { color: colors.text }]}>
            Updated Terms & Privacy Policy
          </Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Please review and accept our updated legal agreements to continue shopping and using JezSy services.
          </Text>
        </View>

        {/* Legal Document Cards */}
        <View style={styles.cardsContainer}>
          {/* Terms Card */}
          <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.docCardHeader}>
              <View style={styles.docTitleBlock}>
                <Text style={[styles.docTitle, { color: colors.text }]}>
                  {termsDoc?.title || 'Terms of Service'}
                </Text>
                <Text style={[styles.docVersion, { color: colors.secondaryText }]}>
                  Version {termsDoc?.version}
                </Text>
              </View>
              {termsViewed ? (
                <View style={styles.reviewedTag}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.reviewedTagText}>Reviewed</Text>
                </View>
              ) : (
                <View style={styles.pendingTag}>
                  <Ionicons name="time-outline" size={16} color="#F59E0B" />
                  <Text style={styles.pendingTagText}>Review Required</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.reviewBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => setActiveReadingDoc('terms')}
              accessibilityRole="button"
              accessibilityLabel="Review Terms of Service in full"
            >
              <Ionicons name="book-outline" size={16} color={colors.tint} />
              <Text style={[styles.reviewBtnText, { color: colors.tint }]}>
                {termsViewed ? 'Re-read Terms of Service' : 'Read Terms of Service'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Privacy Card */}
          <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.docCardHeader}>
              <View style={styles.docTitleBlock}>
                <Text style={[styles.docTitle, { color: colors.text }]}>
                  {privacyDoc?.title || 'Privacy Policy'}
                </Text>
                <Text style={[styles.docVersion, { color: colors.secondaryText }]}>
                  Version {privacyDoc?.version}
                </Text>
              </View>
              {privacyViewed ? (
                <View style={styles.reviewedTag}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.reviewedTagText}>Reviewed</Text>
                </View>
              ) : (
                <View style={styles.pendingTag}>
                  <Ionicons name="time-outline" size={16} color="#F59E0B" />
                  <Text style={styles.pendingTagText}>Review Required</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.reviewBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => setActiveReadingDoc('privacy')}
              accessibilityRole="button"
              accessibilityLabel="Review Privacy Policy in full"
            >
              <Ionicons name="book-outline" size={16} color={colors.tint} />
              <Text style={[styles.reviewBtnText, { color: colors.tint }]}>
                {privacyViewed ? 'Re-read Privacy Policy' : 'Read Privacy Policy'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* View-Before-Accept Checkbox Section */}
        <View style={styles.consentSection}>
          {/* Terms Checkbox */}
          <TouchableOpacity
            style={[
              styles.checkboxRow,
              !termsViewed && styles.checkboxDisabledRow,
            ]}
            onPress={() => termsViewed && setTermsAgreed((prev) => !prev)}
            disabled={!termsViewed}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAgreed, disabled: !termsViewed }}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  borderColor: termsViewed ? (termsAgreed ? colors.tint : colors.border) : colors.border,
                  backgroundColor: termsAgreed ? colors.tint : 'transparent',
                  opacity: termsViewed ? 1 : 0.4,
                },
              ]}
            >
              {termsAgreed && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </View>
            <View style={styles.checkboxLabelContainer}>
              <Text
                style={[
                  styles.checkboxLabel,
                  { color: termsViewed ? colors.text : colors.secondaryText },
                ]}
              >
                I have read and agree to the Terms of Service
              </Text>
              {!termsViewed && (
                <Text style={[styles.checkboxHint, { color: colors.secondaryText }]}>
                  (You must read the Terms document in full first)
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Privacy Checkbox */}
          <TouchableOpacity
            style={[
              styles.checkboxRow,
              !privacyViewed && styles.checkboxDisabledRow,
            ]}
            onPress={() => privacyViewed && setPrivacyAgreed((prev) => !prev)}
            disabled={!privacyViewed}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: privacyAgreed, disabled: !privacyViewed }}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  borderColor: privacyViewed ? (privacyAgreed ? colors.tint : colors.border) : colors.border,
                  backgroundColor: privacyAgreed ? colors.tint : 'transparent',
                  opacity: privacyViewed ? 1 : 0.4,
                },
              ]}
            >
              {privacyAgreed && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </View>
            <View style={styles.checkboxLabelContainer}>
              <Text
                style={[
                  styles.checkboxLabel,
                  { color: privacyViewed ? colors.text : colors.secondaryText },
                ]}
              >
                I acknowledge that I have read the Privacy Policy
              </Text>
              {!privacyViewed && (
                <Text style={[styles.checkboxHint, { color: colors.secondaryText }]}>
                  (You must read the Privacy document in full first)
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* Primary Accept Action */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={[
              styles.primaryActionBtn,
              {
                backgroundColor: termsAgreed && privacyAgreed && !isSubmitting ? colors.tint : colors.border,
              },
            ]}
            onPress={handleAccept}
            disabled={!termsAgreed || !privacyAgreed || isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Accept terms and privacy to continue"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text
                style={[
                  styles.primaryActionBtnText,
                  { color: termsAgreed && privacyAgreed ? '#FFFFFF' : colors.secondaryText },
                ]}
              >
                Accept & Continue
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.footerLinks}>
            <TouchableOpacity
              onPress={handleSupportNavigation}
              accessibilityRole="link"
              accessibilityLabel="Contact support"
            >
              <Text style={[styles.footerLinkText, { color: colors.tint }]}>
                Need Help? Contact In-App Support
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => signOut()}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Text style={[styles.footerLinkText, { color: colors.secondaryText }]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Full-Screen In-App Document Readers */}
      {activeReadingDoc === 'terms' && termsDoc && (
        <LegalReaderModal
          visible={true}
          title={termsDoc.title}
          version={termsDoc.version}
          content={termsDoc.content_markdown}
          documentId={termsDoc.document_id}
          initialViewed={termsViewed}
          onClose={() => setActiveReadingDoc(null)}
          onViewCompleted={() => setTermsViewed(true)}
        />
      )}

      {activeReadingDoc === 'privacy' && privacyDoc && (
        <LegalReaderModal
          visible={true}
          title={privacyDoc.title}
          version={privacyDoc.version}
          content={privacyDoc.content_markdown}
          documentId={privacyDoc.document_id}
          initialViewed={privacyViewed}
          onClose={() => setActiveReadingDoc(null)}
          onViewCompleted={() => setPrivacyViewed(true)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 48,
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  mainTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  cardsContainer: {
    gap: 14,
    marginBottom: 24,
  },
  docCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  docCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  docTitleBlock: {
    flex: 1,
  },
  docTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  docVersion: {
    fontSize: 12,
    marginTop: 2,
  },
  reviewedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  reviewedTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  pendingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  pendingTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  reviewBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  consentSection: {
    gap: 16,
    marginBottom: 28,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkboxDisabledRow: {
    opacity: 0.6,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  checkboxLabelContainer: {
    flex: 1,
  },
  checkboxLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  checkboxHint: {
    fontSize: 12,
    marginTop: 2,
  },
  actionContainer: {
    gap: 16,
  },
  primaryActionBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footerLinks: {
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  footerLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  errorIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorDescription: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  errorActions: {
    width: '100%',
    gap: 12,
  },
  signOutLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  signOutLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
