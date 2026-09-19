import React, { useRef, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, Link, useFocusEffect } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import {
  statusBucket,
  canReschedule,
  isReturnEligible,
  getCustomerReservationDisplayState,
  type CustomerBadgeColorType,
} from '@/src/utils/reservationStatus';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  formatPHDate,
  formatTimeLabel,
  formatManilaDate,
  generateManilaDates,
  isSameManilaDay,
  manilaCalendarDay,
  manilaDayNumber,
  manilaWeekdayLabel,
} from '@/src/utils/dateTime';
import { resolveSignedStorageUrl } from '@/src/utils/signedStorageUrl';
import { useMessages } from '@/src/context/MessagesContext';
import { TimeSlotPicker } from '@/src/components/TimeSlotPicker';
import { useToast } from '@/src/context/ToastContext';
import { showAlert } from '@/src/utils/alert';
import * as ImagePicker from 'expo-image-picker';
import { startReservationPayment, submitReservationBalanceReceipt } from '@/src/lib/payments';
import { uploadPaymentReceipt } from '@/src/lib/receipts';
import { useAuth } from '@/src/context/AuthContext';
import { getReturnRequestWindowDays } from '@/src/services/settingsService';
import { cancelCustomerReservation, getActiveRefundRequest } from '@/src/services/reservationService';
import { ReturnRefundModal } from '@/src/components/reservations/ReturnRefundModal';
import type { PaymentPurpose } from '@/src/utils/reservationPayment';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental &&
  !(globalThis as Record<string, unknown>).nativeFabricUIManager
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Rounded up so a window of 59 minutes reads "1 hour left" rather than
// "0 hours left".
function formatRemaining(dueAt: string): string | null {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMins = Math.floor(ms / 60000);
  if (totalMins < 60) return `${totalMins} minute${totalMins === 1 ? '' : 's'} left to pay`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'} left to pay`;
  return `${hours}h ${mins}m left to pay`;
}

type Reservation = Database['public']['Tables']['reservations']['Row'];
type ReservationItem = Database['public']['Tables']['reservation_items']['Row'];

type ManualMethod = 'gcash' | 'bank_transfer';

type PaymentInstructions = {
  manual_payment_enabled: boolean;
  gcash_enabled: boolean;
  gcash_account_name: string;
  gcash_number: string;
  bank_transfer_enabled: boolean;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  manual_payment_instructions: string;
  manual_payment_reference_instructions: string;
};

export default function ReservationDetailScreen() {
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { getOrCreateConversation } = useMessages();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [items, setItems] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date>(() => manilaCalendarDay(new Date()));
  const [rescheduleSlot, setRescheduleSlot] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptLoadFailed, setReceiptLoadFailed] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  // Synchronous latch: prevents a duplicate payment initiation from a fast double-tap.
  const payBusyRef = useRef(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const { session } = useAuth();
  const [isPickupPassExpanded, setIsPickupPassExpanded] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);

  const togglePickupPass = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsPickupPassExpanded((prev) => !prev);
  }, []);

  // Manual payment: the customer must see where to send money and give
  // staff structured context (method/amount/reference) before a receipt
  // image is judged in isolation. See src/services/... audit notes.
  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null);
  const [boutiqueProfile, setBoutiqueProfile] = useState<{ address?: string }>({});
  const [showManualPayment, setShowManualPayment] = useState(false);
  const [manualMethod, setManualMethod] = useState<ManualMethod | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualReference, setManualReference] = useState('');
  const [confirmedSent, setConfirmedSent] = useState(false);
  const [confirmedReceiptReady, setConfirmedReceiptReady] = useState(false);

  // Remaining balance manual receipt state
  const [showBalanceManualPayment, setShowBalanceManualPayment] = useState(false);
  const [balanceManualMethod, setBalanceManualMethod] = useState<ManualMethod | null>(null);
  const [balanceManualAmount, setBalanceManualAmount] = useState('');
  const [balanceManualReference, setBalanceManualReference] = useState('');
  const [balanceConfirmedSent, setBalanceConfirmedSent] = useState(false);
  const [balanceConfirmedReceiptReady, setBalanceConfirmedReceiptReady] = useState(false);
  const [uploadingBalanceReceipt, setUploadingBalanceReceipt] = useState(false);
  const [balanceReceiptUri, setBalanceReceiptUri] = useState<string | null>(null);
  const [refundRequest, setRefundRequest] = useState<any>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [cancellingReservation, setCancellingReservation] = useState(false);

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['paymentInstructions', 'profile']);
    if (error || !data) return;
    for (const row of data) {
      if (row.key === 'paymentInstructions') setPaymentInstructions(row.value as unknown as PaymentInstructions);
      if (row.key === 'profile') setBoutiqueProfile(row.value as { address?: string });
    }
  }, []);

  const fetchReservation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [resResult, itemsResult, refundReq, paymentsResult] = await Promise.all([
        supabase.from('reservations').select('*').eq('id', id).single(),
        supabase
          .from('reservation_items')
          .select('*')
          .eq('reservation_id', id)
          .order('created_at', { ascending: true }),
        getActiveRefundRequest(id),
        supabase
          .from('payments')
          .select('*')
          .eq('reservation_id', id)
          .order('created_at', { ascending: false }),
      ]);

      if (resResult.error) throw resResult.error;
      setReservation(resResult.data);
      setRefundRequest(refundReq);
      setPayments(paymentsResult.data ?? []);

      if (itemsResult.error) throw itemsResult.error;
      setItems(itemsResult.data ?? []);
    } catch (err) {
      console.error('Error fetching reservation:', err);
      setReservation(null);
      setItems([]);
      setRefundRequest(null);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // receipt_url holds a bare object path in a private bucket, so it needs a
  // signed URL before <Image> can load it. Signed URLs expire after an hour,
  // so this also re-resolves on focus -- otherwise a reservation left open
  // (or revisited later) shows a broken image once the old one lapses.
  const receiptPath = reservation?.receipt_url;
  useFocusEffect(
    useCallback(() => {
      if (!receiptPath) {
        setReceiptUri(null);
        setReceiptLoadFailed(false);
        return;
      }

      let cancelled = false;
      setReceiptLoadFailed(false);
      resolveSignedStorageUrl('payment_receipts', receiptPath).then((url) => {
        if (cancelled) return;
        setReceiptUri(url);
        if (!url) setReceiptLoadFailed(true);
      });

      return () => {
        cancelled = true;
      };
    }, [receiptPath])
  );

  const balanceReceiptPath = reservation?.balance_receipt_url;
  useFocusEffect(
    useCallback(() => {
      if (!balanceReceiptPath) {
        setBalanceReceiptUri(null);
        return;
      }

      let cancelled = false;
      resolveSignedStorageUrl('payment_receipts', balanceReceiptPath).then((url) => {
        if (cancelled) return;
        setBalanceReceiptUri(url);
      });

      return () => {
        cancelled = true;
      };
    }, [balanceReceiptPath])
  );

  useFocusEffect(
    useCallback(() => {
      fetchReservation();
      fetchSettings();
      if (!id) return;

      let channel: ReturnType<typeof supabase.channel> | null = null;
      try {
        channel = supabase
          .channel(`reservation-detail:${id}:${Date.now()}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'reservations', filter: `id=eq.${id}` },
            (payload) => setReservation(payload.new as Reservation),
          )
          .subscribe();
      } catch (err) {
        console.warn('Failed to subscribe to reservation channel:', err);
      }

      return () => {
        if (channel) {
          supabase.removeChannel(channel);
        }
      };
    }, [fetchReservation, fetchSettings, id]),
  );

  const [returnWindowDays, setReturnWindowDays] = useState(7);

  useFocusEffect(
    useCallback(() => {
      getReturnRequestWindowDays().then(setReturnWindowDays).catch(() => {});
    }, [])
  );

  const handleReturnRefundRequest = () => {
    setShowRefundModal(true);
  };

  const handleCancelReservation = useCallback(() => {
    if (!reservation) return;
    showAlert(
      'Cancel Reservation',
      'Are you sure you want to cancel this reservation? The held item will be released back into boutique inventory.',
      [
        { text: 'Keep Reservation', style: 'cancel' },
        {
          text: 'Cancel Reservation',
          style: 'destructive',
          onPress: async () => {
            setCancellingReservation(true);
            try {
              const res = await cancelCustomerReservation(reservation.id);
              if (res.ok) {
                showToast('Reservation cancelled.', 'success');
                await fetchReservation();
              } else {
                console.error('[cancelReservation] Cancel failed:', res.error);
                showToast('Could not cancel your reservation. Please try again.', 'error');
              }
            } finally {
              setCancellingReservation(false);
            }
          },
        },
      ]
    );
  }, [fetchReservation, reservation, showToast]);

  const handleAskAboutReservation = async () => {
    const conv = await getOrCreateConversation();
    if (!conv || !reservation) return;
    router.push({
      pathname: '/messages/[conversationId]',
      params: {
        conversationId: conv.id,
        ctxType: 'reservation',
        ctxRef: reservation.id,
        ctxLabel: `Reservation ${reservation.display_id || reservation.id.substring(0, 8)}${reservation.product_name ? ` - ${reservation.product_name}` : ''}`,
      },
    } as any);
  };

  const handleReschedule = async () => {
    if (!rescheduleSlot) {
      showToast('Please choose a new appointment time.', 'info');
      return;
    }
    setSubmitting(true);
    try {
      // A request, not a change. The booking only moves once staff accept, so
      // nobody arrives to a day that shifted under them. request_reschedule
      // still checks the slot now rather than at approval, so asking for a
      // closed day is refused immediately.
      const { error } = await supabase.rpc('request_reschedule', {
        _reservation_id: id,
        _date: formatManilaDate(rescheduleDate),
        _appointment_time: rescheduleSlot,
      });
      if (error) throw error;
      setShowReschedule(false);
      setRescheduleSlot(undefined);
      await fetchReservation();
      showToast('Request sent. We will confirm once it has been reviewed.', 'success');
    } catch (err: any) {
      console.error('[handleReschedule] Reschedule request failed:', err);
      showToast('Could not send your request. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Opens the PayMongo checkout for an active reservation. This is
  // the path that did not exist before: a customer who closed the checkout
  // page had no way back to it, and simply lost the reservation.
  const handlePayNow = async (purpose: PaymentPurpose) => {
    if (!id) return;
    if (payBusyRef.current) return;
    payBusyRef.current = true;
    setPayBusy(true);
    try {
      const { paymentId, checkoutUrl } = await startReservationPayment(id, purpose);
      router.push({
        pathname: '/payment/[paymentId]',
        params: { paymentId, url: checkoutUrl },
      } as any);
    } catch (err: any) {
      console.warn('[handlePayNow] Payment start failed:', err?.message);
      if (err?.message?.includes('payment has already been received')) {
        setIsPaymentProcessing(true);
        showToast('Your payment was received and is processing.', 'success');
      } else {
        showToast('Could not start the payment. Please try again.', 'error');
      }
      // If payment failed (e.g. 409 conflict, cancelled, expired), refresh
      // reservation state to reflect latest server status and disable stale actions.
      await fetchReservation();
    } finally {
      payBusyRef.current = false;
      setPayBusy(false);
    }
  };

  // Manual transfer path. Uploading only records the claim -- staff still have
  // to verify it, which is what stops a junk image from holding the item.
  //
  // Availability is method-authoritative: if either GCash or Bank Transfer is
  // enabled, manual payment is available for the customer.
  const gcashEnabled = Boolean(paymentInstructions?.gcash_enabled);
  const bankEnabled = Boolean(paymentInstructions?.bank_transfer_enabled);
  const isManualPaymentEnabled = gcashEnabled || bankEnabled;

  const isDepositRejected =
    Boolean(reservation?.last_receipt_rejected_at) &&
    (reservation?.payment_status || 'Pending').toLowerCase() === 'pending';

  const depositRejectionReasonText = useMemo(() => {
    switch (reservation?.last_receipt_rejection_reason) {
      case 'unreadable_receipt':
        return 'The receipt image could not be verified. Please ensure the full receipt is clear, legible, and uncropped.';
      case 'wrong_amount':
        return `The amount shown on the receipt does not match the required reservation fee of ₱${(reservation?.deposit || 0).toFixed(2)}.`;
      case 'invalid_reference':
        return 'The transaction reference number could not be verified with our records.';
      case 'duplicate_receipt':
        return 'This receipt has already been submitted for another transaction.';
      case 'suspected_fraud':
        return 'We could not verify this payment. Please contact boutique staff for assistance.';
      default:
        return 'Your previous payment receipt could not be verified. Please submit a valid receipt or pay using GCash before the deadline.';
    }
  }, [reservation?.last_receipt_rejection_reason, reservation?.deposit]);

  const manualPaymentButtonLabel = useMemo(() => {
    if (isDepositRejected) {
      if (gcashEnabled && !bankEnabled) return 'Upload another GCash receipt';
      if (bankEnabled && !gcashEnabled) return 'Upload another bank transfer receipt';
      return 'Upload another receipt';
    }
    return 'Upload payment receipt';
  }, [gcashEnabled, bankEnabled, isDepositRejected]);

  const balanceManualPaymentButtonLabel = useMemo(() => {
    return 'Upload balance receipt';
  }, [gcashEnabled, bankEnabled]);

  const openManualPayment = () => {
    if (!isManualPaymentEnabled) return;
    const onlyMethod: ManualMethod | null =
      gcashEnabled && !bankEnabled
        ? 'gcash'
        : bankEnabled && !gcashEnabled
          ? 'bank_transfer'
          : null;
    setManualMethod(onlyMethod);
    setManualAmount(reservation ? String(reservation.deposit || '') : '');
    setManualReference('');
    setConfirmedSent(false);
    setConfirmedReceiptReady(false);
    setShowManualPayment(true);
  };

  const manualAmountValue = Number(manualAmount);
  const canSubmitManualPayment =
    !!manualMethod &&
    Number.isFinite(manualAmountValue) &&
    manualAmountValue > 0 &&
    manualReference.trim().length > 0 &&
    confirmedSent &&
    confirmedReceiptReady;

  const handleUploadReceipt = async () => {
    const userId = session?.user?.id;
    if (!id || !userId || !canSubmitManualPayment || !manualMethod) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      showToast('Could not read that image. Please pick another.', 'error');
      return;
    }

    setUploadingReceipt(true);
    try {
      const path = await uploadPaymentReceipt(userId, asset.uri, asset.base64);
      const { error } = await supabase.rpc('submit_reservation_receipt' as any, {
        _reservation_id: id,
        _receipt_path: path,
        _method: manualMethod,
        _amount_claimed: manualAmountValue,
        _reference_number: manualReference.trim(),
      });
      if (error) throw error;
      setShowManualPayment(false);
      await fetchReservation();
      showToast('Receipt sent. We will confirm once it has been checked.', 'success');
    } catch (err: any) {
      console.error('[handleUploadReceipt] Receipt upload failed:', err);
      showToast('Could not send the receipt. Please try again.', 'error');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const openBalanceManualPayment = () => {
    if (!isManualPaymentEnabled) return;
    const onlyMethod: ManualMethod | null =
      gcashEnabled && !bankEnabled
        ? 'gcash'
        : bankEnabled && !gcashEnabled
          ? 'bank_transfer'
          : null;
    const rawBal = (reservation?.rental_price || 0) - (reservation?.deposit || 0);
    setBalanceManualMethod(onlyMethod);
    setBalanceManualAmount(rawBal > 0 ? rawBal.toFixed(2) : '');
    setBalanceManualReference('');
    setBalanceConfirmedSent(false);
    setBalanceConfirmedReceiptReady(false);
    setShowBalanceManualPayment(true);
  };

  const balanceManualAmountValue = Number(balanceManualAmount);
  const canSubmitBalanceManualPayment =
    !!balanceManualMethod &&
    Number.isFinite(balanceManualAmountValue) &&
    balanceManualAmountValue > 0 &&
    balanceManualReference.trim().length > 0 &&
    balanceConfirmedSent &&
    balanceConfirmedReceiptReady;

  const handleUploadBalanceReceipt = async () => {
    const userId = session?.user?.id;
    if (!id || !userId || !canSubmitBalanceManualPayment || !balanceManualMethod) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      showToast('Could not read that image. Please pick another.', 'error');
      return;
    }

    setUploadingBalanceReceipt(true);
    try {
      const path = await uploadPaymentReceipt(userId, asset.uri, asset.base64);
      await submitReservationBalanceReceipt({
        reservationId: id,
        receiptPath: path,
        method: balanceManualMethod,
        amountClaimed: balanceManualAmountValue,
        referenceNumber: balanceManualReference.trim(),
      });
      setShowBalanceManualPayment(false);
      await fetchReservation();
      showToast('Balance receipt sent. We will confirm once it has been checked.', 'success');
    } catch (err: any) {
      console.error('[handleUploadBalanceReceipt] Balance receipt upload failed:', err);
      showToast('Could not send the balance receipt. Please try again.', 'error');
    } finally {
      setUploadingBalanceReceipt(false);
    }
  };

  const refundPayment = useMemo(() => {
    return payments.find((p: any) => p.refund_disbursed_at || p.refund_reference_number || p.status === 'refunded');
  }, [payments]);

  const getStatusColor = (colorType: CustomerBadgeColorType | string | null) => {
    switch (colorType) {
      case 'toPay': return colors.notification;
      case 'paymentUnderReview': return colors.warning;
      case 'paymentReceived': return colors.success;
      case 'preparing': return colors.info;
      case 'ready': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
      case 'refunded': return colors.info;
      default: return colors.secondaryText;
    }
  };

  const refundPayment = useMemo(() => {
    return payments.find((p: any) => p.refund_disbursed_at || p.refund_reference_number || p.status === 'refunded');
  }, [payments]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!reservation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Reservation not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = reservation.date
    ? formatPHDate(reservation.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';
  const displayState = getCustomerReservationDisplayState({
    ...reservation,
    refund_request_status: refundRequest?.status,
  });
  const statusColor = getStatusColor(displayState.badgeColorType);
  // Raw arithmetic, not "what's still owed" -- see isBalanceSettled below.
  // Staff record collection via settle_reservation_balance at pickup, which
  // this screen never checked: the row showed "Balance Due at Pickup: ₱X"
  // forever, even for a Completed reservation staff had already been paid
  // for in person.
  const rawBalanceDue = (reservation.rental_price || 0) - (reservation.deposit || 0);
  const balanceStatus = (reservation.balance_payment_status || '').toLowerCase();
  const isBalanceUnderReview = balanceStatus === 'submitted';
  const isBalanceRejected = balanceStatus === 'rejected';
  const isBalanceSettled = Boolean(reservation.balance_settled_at) || balanceStatus === 'paid';

  const paymentState = (reservation.payment_status || 'Pending').toLowerCase();
  const reservationState = statusBucket(reservation.status);
  const isReservationCancelled =
    reservationState === 'cancelled' ||
    (reservation.status || '').toLowerCase() === 'cancelled' ||
    paymentState === 'cancelled';
  const balanceDue = isBalanceSettled || isReservationCancelled ? 0 : rawBalanceDue;

  // Matches the dashboard's CAN_RESCHEDULE_STATUSES. The old list stopped at
  // 'confirmed', so a customer whose item was already waiting for collection
  // could not move the appointment even though staff could.
  const canRescheduleNow = canReschedule(reservation.status) && !isReservationCancelled;
  // One outstanding request at a time. While it is pending the live booking is
  // still the one to show, so the proposal appears beside it rather than
  // replacing it -- the customer has not moved anything yet.
  const reschedulePending = Boolean(reservation.reschedule_requested_at);

  const awaitingPayment = Boolean(displayState.showToPayAction) && !isReservationCancelled;
  const receiptUnderReview = paymentState === 'submitted' || displayState.badgeColorType === 'paymentUnderReview';
  const timeLeft = displayState.showCountdown && reservation.payment_due_at ? formatRemaining(reservation.payment_due_at) : null;
  const initialPaymentPurpose: PaymentPurpose =
    (reservation.payment_type || '').toLowerCase() === 'full' ? 'full_payment' : 'initial_deposit';
  const canUpgradeToFullPayment = initialPaymentPurpose === 'initial_deposit' && rawBalanceDue > 0 && !isReservationCancelled;
  const canPayRemainingBalance =
    paymentState === 'paid' &&
    !isBalanceSettled &&
    !isBalanceUnderReview &&
    balanceDue > 0 &&
    !isReservationCancelled &&
    reservationState !== 'completed';
  const paymentDisplayStatus = isReservationCancelled
    ? (paymentState === 'refunded'
        ? 'Refunded'
        : paymentState === 'refund required'
          ? 'Refund Required'
          : 'Cancelled')
    : isBalanceSettled
      ? 'Paid in full'
      : paymentState === 'paid'
        ? (isBalanceUnderReview
            ? 'Deposit verified · Balance proof under review'
            : isBalanceRejected
              ? 'Deposit verified · Balance proof needs attention'
              : (balanceDue > 0 ? 'Reservation payment received' : 'Paid in full'))
        : reservation.payment_status || 'Pending';

  // Falls back to the reservation's own denormalised product columns if the
  // lines could not be read, so the screen still shows the item rather than
  // an empty card.
  const displayItems: Pick<
    ReservationItem,
    'id' | 'product_id' | 'product_name' | 'image_url' | 'size' | 'color' | 'quantity'
  >[] = items.length > 0
    ? items
    : [{
        id: reservation.id,
        product_id: reservation.product_id,
        product_name: reservation.product_name,
        image_url: reservation.image_url,
        size: reservation.size,
        color: reservation.color,
        quantity: reservation.quantity ?? 1,
      }];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 4 }}>Reservation Details</Text>
        <Text style={[styles.displayId, { color: colors.secondaryText, marginBottom: 16, fontSize: 16 }]}>
          {reservation.display_id || reservation.id.substring(0, 8)}
        </Text>
        <View style={{ alignSelf: 'flex-start', marginBottom: Spacing.xl }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor, fontSize: 13, fontWeight: '700' }]}>{displayState.label}</Text>
          </View>
        </View>

        {Boolean((reservation as any).confirmed_by_name) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, marginBottom: Spacing.md }}>
            <IconSymbol name="checkmark.seal.fill" size={14} color={colors.tint} />
            <Text style={{ fontSize: 12, color: colors.secondaryText, marginLeft: Spacing.xs }}>
              Confirmed by {(reservation as any).confirmed_by_name}
              {(reservation as any).confirmed_at ? ` on ${formatPHDate((reservation as any).confirmed_at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
          </View>
        )}

        {/* Gated on 'ready', not 'confirmed'. Stored 'Confirmed' means approved
            and still unpaid, so this was showing a pickup pass to customers who
            owed money and hiding it from the ones who had paid. */}
        {reservationState === 'ready' && (
          <View style={[styles.pickupCard, { backgroundColor: colors.tint, overflow: 'hidden' }, !isPickupPassExpanded && styles.pickupCardCollapsed]}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={togglePickupPass}
                style={[styles.pickupHeader, { justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: isPickupPassExpanded ? 0 : 20 }]}
                accessibilityRole="button"
                accessibilityLabel={isPickupPassExpanded ? 'Hide pickup pass' : 'Show pickup pass'}
                accessibilityState={{ expanded: isPickupPassExpanded }}
              >
                <View style={styles.pickupHeaderLeft}>
                  <IconSymbol name={isPickupPassExpanded ? 'chevron.up' : 'checkmark'} size={18} color={colors.onTint} />
                  <Text style={[styles.pickupTitle, { color: colors.onTint }]}>
                    {isPickupPassExpanded ? 'Hide Pickup Pass' : 'Show Pickup Pass'}
                  </Text>
                </View>
                <View style={styles.pickupHeaderRight}>
                  {!isPickupPassExpanded && <IconSymbol name="chevron.right" size={18} color={colors.onTint} />}
                </View>
              </TouchableOpacity>
            {isPickupPassExpanded && (
              <>
                {reservation.pickup_token && (
                  <View style={styles.pickupQrWrap}>
                    <QRCode value={`jezsy-pickup:${reservation.pickup_token}`} size={140} backgroundColor="#FFFFFF" color="#0D0D0D" />
                  </View>
                )}
                <Text style={[styles.pickupRef, { color: colors.onTint }]}>{reservation.display_id || reservation.id.substring(0, 8)}</Text>
                <Text style={[styles.pickupHint, { color: colors.onTint }]}>
                  Show this code at the boutique to collect your item. Bring a valid ID and your remaining balance.
                </Text>
              </>
            )}
          </View>
        )}

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Appointment</Text>
            {canRescheduleNow && !showReschedule && !reschedulePending && (
              <TouchableOpacity
                onPress={() => {
                  setRescheduleDate(manilaCalendarDay(reservation.date ? new Date(reservation.date) : new Date()));
                  setRescheduleSlot(undefined);
                  setShowReschedule(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Request a new appointment time"
                accessibilityHint="Suggests a new date and time for the shop to approve"
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text style={[styles.rescheduleLink, { color: colors.tint }]}>Request new time</Text>
                  <IconSymbol name="chevron.right" size={14} color={colors.tint} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.infoRow, { marginTop: Spacing.md, alignItems: 'flex-start' }]}>
              <IconSymbol name="calendar" size={20} color={colors.tint} />
              <View>
                <Text style={{ color: colors.text, fontSize: 15 }}>
                  {dateStr}
                </Text>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 2 }}>
                  {formatTimeLabel(reservation.appointment_time)}
                </Text>
              </View>
            </View>

          {reschedulePending && (
            <View style={[styles.pendingRequest, { borderColor: colors.border }]}>
              <IconSymbol name="clock.arrow.circlepath" size={16} color={colors.warning} />
              <Text style={[styles.pendingRequestText, { color: colors.secondaryText }]}>
                You asked to move this to{' '}
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {formatManilaDate(new Date(reservation.reschedule_requested_date as string))} at{' '}
                  {formatTimeLabel(reservation.reschedule_requested_at_time)}
                </Text>
                . The time above still stands until the shop confirms.
              </Text>
            </View>
          )}

          {showReschedule && (
            <View style={[styles.reschedulePanel, { borderTopColor: colors.border }]}>
              <Text style={[styles.rescheduleLabel, { color: colors.secondaryText }]}>Select a new date</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
                {generateManilaDates(14).map((d, index) => {
                  const isSelected = isSameManilaDay(d, rescheduleDate);
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[styles.dateBox, { borderColor: isSelected ? colors.tint : colors.border }, isSelected && { backgroundColor: colors.background }]}
                      onPress={() => { setRescheduleDate(d); setRescheduleSlot(undefined); }}
                      accessibilityRole="button"
                      accessibilityLabel={`${manilaWeekdayLabel(d)} ${manilaDayNumber(d)}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.dayName, { color: isSelected ? colors.tint : colors.secondaryText }]}>
                        {manilaWeekdayLabel(d)}
                      </Text>
                      <Text style={[styles.dateNum, { color: isSelected ? colors.tint : colors.text }]}>{manilaDayNumber(d)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={[styles.rescheduleLabel, { color: colors.secondaryText }]}>Select a new time</Text>
              <TimeSlotPicker selectedDate={rescheduleDate} selectedSlot={rescheduleSlot} onSelectSlot={setRescheduleSlot} />
              <View style={styles.rescheduleActions}>
                <TouchableOpacity
                  style={[styles.rescheduleCancel, { borderColor: colors.border }]}
                  onPress={() => { setShowReschedule(false); setRescheduleSlot(undefined); }}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel reschedule"
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rescheduleConfirm, { backgroundColor: (!rescheduleSlot || submitting) ? colors.border : colors.tint }]}
                  onPress={handleReschedule}
                  disabled={!rescheduleSlot || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm new appointment"
                  accessibilityState={{ disabled: !rescheduleSlot || submitting }}
                >
                  {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={{ fontWeight: '700' }}>Confirm</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Location</Text>
          <View style={[styles.infoRow, { alignItems: 'flex-start' }]}>
            <IconSymbol name="mappin.and.ellipse" size={20} color={colors.tint} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>JezSy Boutique</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 15, marginTop: 4, lineHeight: 22 }}>
                {boutiqueProfile.address || '123 Fashion Street, Makati City, Philippines'}
              </Text>
            </View>
          </View>
        </View>
        {displayItems.length > 1 && (
          <Text style={[styles.itemsHeading, { color: colors.secondaryText }]}>
            {displayItems.length} items in this reservation
          </Text>
        )}

        {displayItems.map((item, index) => {
            const cardContent = (
              <View
                style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Image
                  source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                  style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
                  contentFit="cover"
                />
                <View style={styles.productInfo}>
                  <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                    {item.product_name}
                  </Text>
                  <Text style={[styles.productDetails, { color: colors.secondaryText }]}>
                    Size {item.size || 'One Size'} &middot; {item.color || 'Default'}
                    {(item.quantity ?? 1) > 1 ? ` &middot; Qty ${item.quantity}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <Text style={[styles.viewProductLink, { color: colors.tint, marginTop: 0 }]}>View product</Text>
                    <IconSymbol name="chevron.right" size={14} color={colors.tint} style={{ marginLeft: 4 }} />
                  </View>
                </View>
              </View>
            );

            return item.product_id ? (
              <Link key={item.id ?? `${item.product_id}-${index}`} href={`/product/${item.product_id}`} asChild>
                <TouchableOpacity activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`View ${item.product_name}`}>
                  {cardContent}
                </TouchableOpacity>
              </Link>
            ) : (
              <View key={item.id ?? `${item.product_id}-${index}`}>
                {cardContent}
              </View>
            );
          })}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg }}>
          <TouchableOpacity
              onPress={handleAskAboutReservation}
              accessibilityRole="button"
              accessibilityLabel="Ask the shop owner about this reservation"
              style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <IconSymbol name="bubble.left.and.bubble.right" size={20} color={colors.tint} />
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 }}>Ask about this reservation</Text>
              <IconSymbol name="chevron.right" size={16} color={colors.secondaryText} />
            </TouchableOpacity>

          {reservationState === 'completed' &&
            (!refundRequest || refundRequest.status === 'rejected') &&
            isReturnEligible(
              { completed_at: (reservation as any).completed_at, date: reservation.date },
              returnWindowDays
            ) && (
              <TouchableOpacity
                onPress={handleReturnRefundRequest}
                accessibilityRole="button"
                accessibilityLabel="Request return or refund"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: Spacing.md,
                  paddingVertical: 6,
                  borderRadius: Radius.pill,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Return / Refund</Text>
              </TouchableOpacity>
            )}
        </View>

        {refundRequest && ['submitted', 'under_review'].includes(refundRequest.status) && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.warning }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="clock.arrow.circlepath" size={18} color={colors.warning} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                Return / Refund Request Under Review
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.xs }]}>
              Reason: <Text style={{ fontWeight: '700', color: colors.text }}>{refundRequest.reason_category}</Text>
            </Text>
            {refundRequest.details ? (
              <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.xs }]}>
                &ldquo;{refundRequest.details}&rdquo;
              </Text>
            ) : null}
            <Text style={[styles.rowText, { color: colors.secondaryText, fontSize: 12 }]}>
              Submitted {formatPHDate(refundRequest.submitted_at || refundRequest.created_at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}. Boutique staff are reviewing your request.
            </Text>
          </View>
        )}

        {(paymentState === 'refund required' || refundRequest?.status === 'approved') && paymentState !== 'refunded' && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.tint }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="checkmark.circle" size={18} color={colors.tint} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                Refund Approved
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Your return/refund request has been approved by boutique staff. Staff are preparing your refund disbursement.
            </Text>
            {refundRequest?.resolution_notes ? (
              <View style={{ marginTop: Spacing.sm, padding: Spacing.md, backgroundColor: colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border }}>
                <Text style={[styles.rowText, { color: colors.secondaryText, fontSize: 13 }]}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Staff Note: </Text>
                  &ldquo;{refundRequest.resolution_notes}&rdquo;
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {refundRequest?.status === 'rejected' && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.error }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="xmark.circle" size={18} color={colors.error} />
              <Text style={[styles.sectionTitle, { color: colors.error, marginBottom: 0 }]}>
                Return Request Declined
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.xs }]}>
              Your return/refund request was reviewed and could not be approved.
            </Text>
            {refundRequest.resolution_notes ? (
              <View style={{ marginTop: Spacing.xs, padding: Spacing.md, backgroundColor: colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border }}>
                <Text style={[styles.rowText, { color: colors.secondaryText, fontSize: 13 }]}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Reason: </Text>
                  &ldquo;{refundRequest.resolution_notes}&rdquo;
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {(paymentState === 'refunded' || refundPayment) && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.tint }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="checkmark.circle" size={18} color={colors.tint} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                Refund Disbursed
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.sm }]}>
              Your refund has been disbursed by boutique staff.
            </Text>
            <View style={{ padding: Spacing.md, backgroundColor: colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
              {refundPayment?.amount_centavos ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: colors.secondaryText }}>Amount Refunded</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
                    ₱{(refundPayment.amount_centavos / 100).toFixed(2)}
                  </Text>
                </View>
              ) : null}
              {refundPayment?.refund_method ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: colors.secondaryText }}>Method</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, textTransform: 'capitalize' }}>
                    {refundPayment.refund_method.replace(/_/g, ' ')}
                  </Text>
                </View>
              ) : null}
              {refundPayment?.refund_reference_number ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: colors.secondaryText }}>Reference No.</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                    {refundPayment.refund_reference_number}
                  </Text>
                </View>
              ) : null}
              {refundPayment?.refund_disbursed_at ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: colors.secondaryText }}>Disbursed On</Text>
                  <Text style={{ fontSize: 13, color: colors.secondaryText }}>
                    {formatPHDate(refundPayment.refund_disbursed_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              ) : null}
              {refundPayment?.refund_notes ? (
                <View style={{ marginTop: 4, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.secondaryText, fontStyle: 'italic' }}>
                    Note: &ldquo;{refundPayment.refund_notes}&rdquo;
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {displayState.label === 'Expired' && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.error }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="xmark.circle" size={18} color={colors.error} />
              <Text style={[styles.sectionTitle, { color: colors.error, marginBottom: 0 }]}>
                Payment window expired
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.lg }]}>
              The payment deadline for this reservation has passed.
            </Text>
            <TouchableOpacity
              style={[styles.payPrimary, { backgroundColor: colors.border }]}
              onPress={() => router.replace('/(tabs)')}
            >
              <Text style={[styles.payPrimaryText, { color: colors.text }]}>Make a new reservation</Text>
            </TouchableOpacity>
          </View>
        )}

        {awaitingPayment && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: isDepositRejected ? colors.error : colors.tint }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              {isDepositRejected && <IconSymbol name="exclamationmark.circle" size={18} color={colors.error} />}
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                {isDepositRejected ? 'Payment proof needs attention' : 'Payment needed'}
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.text, fontWeight: '700', fontSize: 16, marginBottom: Spacing.md }]}>
              ₱{(reservation.deposit || 0).toFixed(2)} due
            </Text>

            {isDepositRejected ? (
              <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
                {depositRejectionReasonText}
              </Text>
            ) : reservation.payment_due_at ? (
              <View style={[styles.payDeadline, { borderColor: colors.border, marginBottom: Spacing.lg, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md }]}>
                <Text style={{ color: colors.secondaryText, fontSize: 13, marginBottom: 2 }}>Pay before:</Text>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                  {formatPHDate(reservation.payment_due_at, { month: 'long', day: 'numeric', year: 'numeric' })} &middot; {formatPHDate(reservation.payment_due_at, { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.payPrimary, { backgroundColor: colors.tint, opacity: payBusy || uploadingReceipt || isPaymentProcessing ? 0.6 : 1 }]}
              onPress={() => handlePayNow(initialPaymentPurpose)}
              disabled={payBusy || uploadingReceipt || isPaymentProcessing}
              accessibilityRole="button"
              accessibilityLabel={initialPaymentPurpose === 'full_payment' ? 'Pay in full with GCash' : 'Pay reservation fee with GCash'}
              accessibilityState={{ disabled: payBusy || uploadingReceipt || isPaymentProcessing }}
            >
              {payBusy ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.payPrimaryText, { color: colors.onTint }]}>
                  {isPaymentProcessing
                    ? 'Payment processing...'
                    : initialPaymentPurpose === 'full_payment'
                      ? `Pay ₱${(reservation.rental_price || 0).toFixed(2)} in full with GCash`
                      : `Pay ₱${(reservation.deposit || 0).toFixed(2)} with GCash`}
                </Text>
              )}
            </TouchableOpacity>

            {canUpgradeToFullPayment && (
              <TouchableOpacity
                style={[styles.paySecondary, { borderColor: colors.tint, opacity: payBusy || uploadingReceipt || isPaymentProcessing ? 0.6 : 1 }]}
                onPress={() => handlePayNow('full_payment')}
                disabled={payBusy || uploadingReceipt || isPaymentProcessing}
                accessibilityRole="button"
                accessibilityLabel="Switch to full payment with GCash"
                accessibilityHint="Expires the previous unpaid checkout and opens a checkout for the full item price"
                accessibilityState={{ disabled: payBusy || uploadingReceipt || isPaymentProcessing }}
              >
                <Text style={[styles.paySecondaryText, { color: colors.tint }]}>Pay in full instead</Text>
              </TouchableOpacity>
            )}

            {isManualPaymentEnabled && !showManualPayment && (
              <TouchableOpacity
                style={[styles.paySecondary, { borderColor: colors.border, opacity: payBusy || uploadingReceipt || isPaymentProcessing ? 0.6 : 1 }]}
                onPress={openManualPayment}
                disabled={payBusy || uploadingReceipt || isPaymentProcessing}
                accessibilityRole="button"
                accessibilityLabel={manualPaymentButtonLabel}
                accessibilityHint="Shows where to send payment, then lets you upload a receipt for staff to check"
                accessibilityState={{ disabled: payBusy || uploadingReceipt || isPaymentProcessing }}
              >
                <Text style={[styles.paySecondaryText, { color: colors.text }]}>
                  {manualPaymentButtonLabel}
                </Text>
              </TouchableOpacity>
            )}

            {!showManualPayment && (
              <TouchableOpacity
                style={[styles.paySecondary, { borderColor: colors.border, marginTop: Spacing.sm }]}
                onPress={handleCancelReservation}
                disabled={cancellingReservation || payBusy}
                accessibilityRole="button"
                accessibilityLabel="Cancel reservation"
              >
                {cancellingReservation ? (
                  <ActivityIndicator color={colors.secondaryText} />
                ) : (
                  <Text style={[styles.paySecondaryText, { color: colors.secondaryText }]}>
                    Cancel Reservation
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {showManualPayment && (
              <View style={styles.manualPaymentPanel}>
                {paymentInstructions?.gcash_enabled && (
                  <TouchableOpacity
                    style={[
                      styles.methodChip,
                      { borderColor: manualMethod === 'gcash' ? colors.tint : colors.border },
                      manualMethod === 'gcash' && { backgroundColor: colors.tint + '15' },
                    ]}
                    onPress={() => setManualMethod('gcash')}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: manualMethod === 'gcash' }}
                    accessibilityLabel="Pay via GCash"
                  >
                    <Text style={[styles.methodChipLabel, { color: colors.text }]}>GCash</Text>
                    <Text style={[styles.rowText, { color: colors.secondaryText }]} selectable>
                      {paymentInstructions.gcash_account_name} · {paymentInstructions.gcash_number}
                    </Text>
                  </TouchableOpacity>
                )}
                {paymentInstructions?.bank_transfer_enabled && (
                  <TouchableOpacity
                    style={[
                      styles.methodChip,
                      { borderColor: manualMethod === 'bank_transfer' ? colors.tint : colors.border },
                      manualMethod === 'bank_transfer' && { backgroundColor: colors.tint + '15' },
                    ]}
                    onPress={() => setManualMethod('bank_transfer')}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: manualMethod === 'bank_transfer' }}
                    accessibilityLabel="Pay via bank transfer"
                  >
                    <Text style={[styles.methodChipLabel, { color: colors.text }]}>Bank Transfer</Text>
                    <Text style={[styles.rowText, { color: colors.secondaryText }]} selectable>
                      {paymentInstructions.bank_name} · {paymentInstructions.bank_account_name} · {paymentInstructions.bank_account_number}
                    </Text>
                  </TouchableOpacity>
                )}

                {!!paymentInstructions?.manual_payment_instructions && (
                  <Text style={[styles.rowText, { color: colors.secondaryText, marginTop: Spacing.sm }]}>
                    {paymentInstructions.manual_payment_instructions}
                  </Text>
                )}
                {!!paymentInstructions?.manual_payment_reference_instructions && (
                  <Text style={[styles.rowText, { color: colors.secondaryText, marginTop: Spacing.xs }]}>
                    {paymentInstructions.manual_payment_reference_instructions}
                  </Text>
                )}

                <Text style={[styles.rescheduleLabel, { color: colors.secondaryText, marginTop: Spacing.lg }]}>
                  Amount sent
                </Text>
                <TextInput
                  value={manualAmount}
                  onChangeText={setManualAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.secondaryText}
                  style={[styles.textInput, { borderColor: colors.border, color: colors.text }]}
                  accessibilityLabel="Amount sent"
                />

                <Text style={[styles.rescheduleLabel, { color: colors.secondaryText, marginTop: Spacing.md }]}>
                  Reference number
                </Text>
                <TextInput
                  value={manualReference}
                  onChangeText={setManualReference}
                  placeholder="e.g. GCash reference or bank transaction ID"
                  placeholderTextColor={colors.secondaryText}
                  style={[styles.textInput, { borderColor: colors.border, color: colors.text }]}
                  accessibilityLabel="Payment reference number"
                />

                <TouchableOpacity
                  style={styles.checklistRow}
                  onPress={() => setConfirmedSent((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: confirmedSent }}
                  accessibilityLabel="I sent payment to the account shown above"
                >
                  <IconSymbol
                    name={confirmedSent ? 'checkmark.circle.fill' : 'checkmark.circle'}
                    size={20}
                    color={confirmedSent ? colors.tint : colors.secondaryText}
                  />
                  <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>
                    I sent payment to the account shown above
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.checklistRow}
                  onPress={() => setConfirmedReceiptReady((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: confirmedReceiptReady }}
                  accessibilityLabel="I have a receipt or screenshot ready"
                >
                  <IconSymbol
                    name={confirmedReceiptReady ? 'checkmark.circle.fill' : 'checkmark.circle'}
                    size={20}
                    color={confirmedReceiptReady ? colors.tint : colors.secondaryText}
                  />
                  <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>
                    I have a receipt or screenshot ready
                  </Text>
                </TouchableOpacity>

                <View style={styles.rescheduleActions}>
                  <TouchableOpacity
                    style={[styles.rescheduleCancel, { borderColor: colors.border }]}
                    onPress={() => setShowManualPayment(false)}
                    disabled={uploadingReceipt}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel manual payment"
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.rescheduleConfirm,
                      { backgroundColor: !canSubmitManualPayment || uploadingReceipt ? colors.border : colors.tint },
                    ]}
                    onPress={handleUploadReceipt}
                    disabled={!canSubmitManualPayment || uploadingReceipt}
                    accessibilityRole="button"
                    accessibilityLabel="Upload receipt"
                    accessibilityState={{ disabled: !canSubmitManualPayment || uploadingReceipt }}
                  >
                    {uploadingReceipt ? (
                      <ActivityIndicator color={colors.background} />
                    ) : (
                      <Text style={{ fontWeight: '700' }}>Upload Receipt</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {receiptUnderReview && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Receipt under review</Text>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              We have your receipt and are checking it. Your reservation is held while we do.
            </Text>
          </View>
        )}

        {/* Remaining Balance Domain */}
        {isBalanceUnderReview && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="clock.arrow.circlepath" size={18} color={colors.warning} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                Remaining balance proof under review
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
              Your deposit is confirmed. Staff are checking your balance payment proof for ₱{rawBalanceDue.toFixed(2)}.
            </Text>
            {(reservation.balance_payment_method || reservation.balance_reference_number || reservation.balance_amount_claimed) && (
              <View style={[styles.pendingRequest, { borderColor: colors.border, marginBottom: Spacing.md }]}>
                {reservation.balance_amount_claimed != null && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                    <Text style={{ color: colors.secondaryText, fontSize: 13 }}>Amount claimed</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                      ₱{Number(reservation.balance_amount_claimed).toFixed(2)}
                    </Text>
                  </View>
                )}
                {reservation.balance_payment_method && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
                    <Text style={{ color: colors.secondaryText, fontSize: 13 }}>Method</Text>
                    <Text style={{ color: colors.text, fontSize: 13 }}>
                      {reservation.balance_payment_method === 'gcash' ? 'GCash' : 'Bank Transfer'}
                    </Text>
                  </View>
                )}
                {reservation.balance_reference_number && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
                    <Text style={{ color: colors.secondaryText, fontSize: 13 }}>Reference</Text>
                    <Text style={{ color: colors.text, fontSize: 13 }} selectable>
                      {reservation.balance_reference_number}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {balanceReceiptUri && (
              <Image source={{ uri: balanceReceiptUri }} style={styles.receiptImage} contentFit="contain" />
            )}
          </View>
        )}

        {isBalanceRejected && !showBalanceManualPayment && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.error }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs }}>
              <IconSymbol name="exclamationmark.circle" size={18} color={colors.error} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                Balance proof needs attention
              </Text>
            </View>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
              {reservation.balance_payment_issue === 'image_unclear'
                ? 'The receipt image could not be verified. Please ensure the full receipt is clear and legible.'
                : reservation.balance_payment_issue === 'amount_mismatch'
                  ? `The amount shown does not match your remaining balance of ₱${balanceDue.toFixed(2)}.`
                  : reservation.balance_payment_issue === 'reference_unverified'
                    ? 'The payment reference could not be verified.'
                    : "We couldn't verify your balance payment proof. You can upload a new receipt or pay at the boutique."}
            </Text>
            <TouchableOpacity
              style={[styles.payPrimary, { backgroundColor: colors.tint, opacity: payBusy ? 0.6 : 1, marginBottom: Spacing.sm }]}
              onPress={() => handlePayNow('remaining_balance')}
              disabled={payBusy}
              accessibilityRole="button"
              accessibilityLabel="Pay remaining balance with GCash"
            >
              {payBusy ? <ActivityIndicator color={colors.onTint} /> : <Text style={[styles.payPrimaryText, { color: colors.onTint }]}>Pay balance with GCash</Text>}
            </TouchableOpacity>
            {isManualPaymentEnabled && (
              <TouchableOpacity
                style={[styles.paySecondary, { borderColor: colors.tint }]}
                onPress={openBalanceManualPayment}
                accessibilityRole="button"
                accessibilityLabel="Upload another balance receipt"
              >
                <Text style={[styles.paySecondaryText, { color: colors.tint }]}>Upload another receipt</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {canPayRemainingBalance && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.tint }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Remaining balance</Text>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
              Pay ₱{balanceDue.toFixed(2)} now, or settle it with the boutique before collecting your item.
            </Text>
            <TouchableOpacity
              style={[styles.payPrimary, { backgroundColor: colors.tint, opacity: payBusy || uploadingBalanceReceipt ? 0.6 : 1 }]}
              onPress={() => handlePayNow('remaining_balance')}
              disabled={payBusy || uploadingBalanceReceipt}
              accessibilityRole="button"
              accessibilityLabel="Pay remaining balance with GCash"
              accessibilityState={{ disabled: payBusy || uploadingBalanceReceipt }}
            >
              {payBusy ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.payPrimaryText, { color: colors.onTint }]}>Pay balance with GCash</Text>
              )}
            </TouchableOpacity>

            {isManualPaymentEnabled && !showBalanceManualPayment && (
              <TouchableOpacity
                style={[styles.paySecondary, { borderColor: colors.border, opacity: payBusy || uploadingBalanceReceipt ? 0.6 : 1 }]}
                onPress={openBalanceManualPayment}
                disabled={payBusy || uploadingBalanceReceipt}
                accessibilityRole="button"
                accessibilityLabel={balanceManualPaymentButtonLabel}
                accessibilityHint="Shows where to send remaining balance, then lets you upload a receipt for staff to check"
                accessibilityState={{ disabled: payBusy || uploadingBalanceReceipt }}
              >
                <Text style={[styles.paySecondaryText, { color: colors.text }]}>
                  {balanceManualPaymentButtonLabel}
                </Text>
              </TouchableOpacity>
            )}

            {showBalanceManualPayment && (
              <View style={styles.manualPaymentPanel}>
                {paymentInstructions?.gcash_enabled && (
                  <TouchableOpacity
                    style={[
                      styles.methodChip,
                      { borderColor: balanceManualMethod === 'gcash' ? colors.tint : colors.border },
                      balanceManualMethod === 'gcash' && { backgroundColor: colors.tint + '15' },
                    ]}
                    onPress={() => setBalanceManualMethod('gcash')}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: balanceManualMethod === 'gcash' }}
                    accessibilityLabel="Pay via GCash"
                  >
                    <Text style={[styles.methodChipLabel, { color: colors.text }]}>GCash</Text>
                    <Text style={[styles.rowText, { color: colors.secondaryText }]} selectable>
                      {paymentInstructions.gcash_account_name} · {paymentInstructions.gcash_number}
                    </Text>
                  </TouchableOpacity>
                )}
                {paymentInstructions?.bank_transfer_enabled && (
                  <TouchableOpacity
                    style={[
                      styles.methodChip,
                      { borderColor: balanceManualMethod === 'bank_transfer' ? colors.tint : colors.border },
                      balanceManualMethod === 'bank_transfer' && { backgroundColor: colors.tint + '15' },
                    ]}
                    onPress={() => setBalanceManualMethod('bank_transfer')}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: balanceManualMethod === 'bank_transfer' }}
                    accessibilityLabel="Pay via bank transfer"
                  >
                    <Text style={[styles.methodChipLabel, { color: colors.text }]}>Bank Transfer</Text>
                    <Text style={[styles.rowText, { color: colors.secondaryText }]} selectable>
                      {paymentInstructions.bank_name} · {paymentInstructions.bank_account_name} · {paymentInstructions.bank_account_number}
                    </Text>
                  </TouchableOpacity>
                )}

                {paymentInstructions?.manual_payment_instructions ? (
                  <Text style={[styles.rowText, { color: colors.secondaryText, marginTop: Spacing.sm }]}>
                    {paymentInstructions.manual_payment_instructions}
                  </Text>
                ) : null}

                <Text style={[styles.rescheduleLabel, { color: colors.secondaryText, marginTop: Spacing.lg }]}>
                  Amount sent (₱)
                </Text>
                <TextInput
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                  keyboardType="decimal-pad"
                  value={balanceManualAmount}
                  onChangeText={setBalanceManualAmount}
                  placeholder={`e.g. ${balanceDue.toFixed(2)}`}
                  placeholderTextColor={colors.secondaryText}
                  accessibilityLabel="Amount sent"
                />

                <Text style={[styles.rescheduleLabel, { color: colors.secondaryText, marginTop: Spacing.md }]}>
                  Reference number
                </Text>
                <TextInput
                  style={[styles.textInput, { color: colors.text, borderColor: colors.border }]}
                  value={balanceManualReference}
                  onChangeText={setBalanceManualReference}
                  placeholder="e.g. 1002 9847 1234"
                  placeholderTextColor={colors.secondaryText}
                  accessibilityLabel="Payment reference number"
                />

                <TouchableOpacity
                  style={styles.checklistRow}
                  onPress={() => setBalanceConfirmedSent((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: balanceConfirmedSent }}
                  accessibilityLabel="I sent payment to the account shown above"
                >
                  <IconSymbol
                    name={balanceConfirmedSent ? 'checkmark.circle.fill' : 'checkmark.circle'}
                    size={20}
                    color={balanceConfirmedSent ? colors.tint : colors.secondaryText}
                  />
                  <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>
                    I sent balance payment to the account shown above
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.checklistRow}
                  onPress={() => setBalanceConfirmedReceiptReady((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: balanceConfirmedReceiptReady }}
                  accessibilityLabel="I have a receipt or screenshot ready"
                >
                  <IconSymbol
                    name={balanceConfirmedReceiptReady ? 'checkmark.circle.fill' : 'checkmark.circle'}
                    size={20}
                    color={balanceConfirmedReceiptReady ? colors.tint : colors.secondaryText}
                  />
                  <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>
                    I have a receipt or screenshot ready
                  </Text>
                </TouchableOpacity>

                <View style={styles.rescheduleActions}>
                  <TouchableOpacity
                    style={[styles.rescheduleCancel, { borderColor: colors.border }]}
                    onPress={() => setShowBalanceManualPayment(false)}
                    disabled={uploadingBalanceReceipt}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel balance manual payment"
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.rescheduleConfirm,
                      { backgroundColor: !canSubmitBalanceManualPayment || uploadingBalanceReceipt ? colors.border : colors.tint },
                    ]}
                    onPress={handleUploadBalanceReceipt}
                    disabled={!canSubmitBalanceManualPayment || uploadingBalanceReceipt}
                    accessibilityRole="button"
                    accessibilityLabel="Upload balance receipt"
                    accessibilityState={{ disabled: !canSubmitBalanceManualPayment || uploadingBalanceReceipt }}
                  >
                    {uploadingBalanceReceipt ? (
                      <ActivityIndicator color={colors.background} />
                    ) : (
                      <Text style={{ fontWeight: '700' }}>Upload Balance Receipt</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.lg }}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Payment</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[{ fontSize: 16, fontWeight: '700', color: paymentDisplayStatus === 'Paid in full' ? colors.success : colors.text }]}>{paymentDisplayStatus}</Text>
              {paymentDisplayStatus === 'Paid in full' && <IconSymbol name="checkmark" size={16} color={colors.success} />}
            </View>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Item Price</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>₱{(reservation.rental_price || 0).toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              {(reservation.payment_type || 'Deposit') === 'Full' ? 'Amount to pay (full)' : 'Reservation Fee (50%)'}
            </Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>₱{(reservation.deposit || 0).toFixed(2)}</Text>
          </View>
          <View style={[styles.row, { marginBottom: 0 }]}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              {isBalanceSettled ? 'Balance payment' : (isReservationCancelled ? 'Balance Due' : 'Remaining balance')}
            </Text>
            {isReservationCancelled ? (
              <Text style={[styles.rowValue, { color: colors.secondaryText }]}>-</Text>
            ) : (
              <Text style={[styles.rowValue, { color: isBalanceSettled ? colors.success : colors.tint }]}>₱{balanceDue.toFixed(2)}</Text>
            )}
          </View>
          {isBalanceSettled && reservation.balance_settled_at && (
            <Text style={[styles.rowText, { color: colors.secondaryText, fontSize: 14, marginTop: 4 }]}>
              Paid {formatPHDate(reservation.balance_settled_at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>

        {reservation.receipt_url && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Receipt</Text>
            {receiptUri ? (
              <Image source={{ uri: receiptUri }} style={styles.receiptImage} contentFit="contain" />
            ) : receiptLoadFailed ? (
              <View style={[styles.receiptImage, styles.receiptPlaceholder]}>
                <IconSymbol name="exclamationmark.circle" size={20} color={colors.error} />
                <Text style={[styles.rowText, { color: colors.error, marginTop: Spacing.sm }]}>
                  Could not load your receipt. Pull to refresh, or try again later.
                </Text>
              </View>
            ) : (
              <View style={[styles.receiptImage, styles.receiptPlaceholder]}>
                <ActivityIndicator color={colors.tint} />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <ReturnRefundModal
        visible={showRefundModal}
        reservation={reservation}
        onClose={() => setShowRefundModal(false)}
        onSuccess={async () => {
          await fetchReservation();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  payDeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: 14,
  },
  payDeadlineText: { fontSize: 13, fontWeight: '700', flex: 1 },
  payPrimary: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  payPrimaryText: { fontSize: 15, fontWeight: '700' },
  paySecondary: {
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  paySecondaryText: { fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  backButton: { padding: Spacing.xs },
  headerTitle: { ...Type.subtitle },
  content: { padding: Spacing.xl, paddingBottom: 60 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  displayId: { ...Type.caption },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  // Type.label is the uppercase eyebrow slot; its tracking is why it exists.
  statusText: { ...Type.label, textTransform: 'uppercase' },
  pickupCard: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  pickupCardCollapsed: {
    padding: 0,
  },
  pickupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  pickupHeaderCollapsed: {
    marginBottom: 0,
  },
  pickupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pickupHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  pickupTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  pickupToggleText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  pickupQrWrap: { alignSelf: 'center', padding: Spacing.md, borderRadius: Radius.md, backgroundColor: '#FFFFFF', marginBottom: Spacing.lg },
  pickupRef: { fontSize: 28, fontWeight: '900', letterSpacing: 2, marginBottom: Spacing.sm, textAlign: 'center' },
  pickupHint: { fontSize: 12, lineHeight: 17 },
  productCard: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  productImage: { width: 100, height: 120 },
  productInfo: { flex: 1, padding: Spacing.lg, justifyContent: 'center', gap: Spacing.xs },
  productName: { ...Type.bodyLargeStrong, fontSize: 17 },
  productDetails: { fontSize: 15, marginTop: 4 },
  viewProductLink: { fontSize: 15, fontWeight: '600', marginTop: Spacing.xs },
  itemsHeading: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  askRow: { marginBottom: Spacing.lg },
  sectionCard: {
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  sectionTitle: { ...Type.bodyLargeStrong, marginBottom: Spacing.lg },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { fontSize: 15, fontWeight: '500' },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rescheduleLink: { fontSize: 15, fontWeight: '700' },
  pendingRequest: {
    flexDirection: 'row',
    // flex-start, not centre: this wraps to two or three lines and centring
    // would float the icon into the middle of them.
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // flex so the copy wraps inside the card instead of running past its padding.
  pendingRequestText: { ...Type.caption, flex: 1 },
  reschedulePanel: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rescheduleLabel: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  dateBox: {
    width: 60,
    height: 68,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dayName: { fontSize: 12, marginBottom: Spacing.xs },
  dateNum: { ...Type.subtitle },
  rescheduleActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  rescheduleCancel: {
    flex: 1,
    height: 48,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescheduleConfirm: {
    flex: 1,
    height: 48,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  manualPaymentPanel: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  methodChip: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  methodChipLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  textInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: Spacing.xs,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  // The price breakdown, left as literals for the same reason as reserve/[id]:
  // rowText is an exact Type.body match but rowValue is 14/600, which the scale
  // has no slot for. Converting only the label would give it a lineHeight its
  // amount does not have and pull the two off a shared baseline.
  rowText: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: '600' },
  paymentStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  receiptImage: {
    width: '100%',
    height: 200,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(128,128,128,0.08)',
  },
  receiptPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
});
