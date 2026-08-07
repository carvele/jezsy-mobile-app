import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, Link, useFocusEffect } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { statusBucket, statusLabel, isAwaitingPayment, canReschedule } from '@/src/utils/reservationStatus';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatTimeLabel, formatLocalDate } from '@/src/utils/dateTime';
import { resolveSignedStorageUrl } from '@/src/utils/signedStorageUrl';
import { useMessages } from '@/src/context/MessagesContext';
import { TimeSlotPicker } from '@/src/components/TimeSlotPicker';
import { useToast } from '@/src/context/ToastContext';
import * as ImagePicker from 'expo-image-picker';
import { startReservationPayment } from '@/src/lib/payments';
import { uploadPaymentReceipt } from '@/src/lib/receipts';
import { useAuth } from '@/src/context/AuthContext';

// Rounded up so a window of 59 minutes reads "1 hour left" rather than
// "0 hours left".
function formatRemaining(dueAt: string): string | null {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} left to pay`;
  const hours = Math.ceil(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} left to pay`;
}

type Reservation = Database['public']['Tables']['reservations']['Row'];
type ReservationItem = Database['public']['Tables']['reservation_items']['Row'];

export default function ReservationDetailScreen() {
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { getOrCreateConversation } = useMessages();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [items, setItems] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date>(new Date());
  const [rescheduleSlot, setRescheduleSlot] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptLoadFailed, setReceiptLoadFailed] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const { session } = useAuth();

  const fetchReservation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('reservations').select('*').eq('id', id).single();
      if (error) throw error;
      setReservation(data);

      // Lines live in reservation_items. Every reservation has at least one
      // (older rows were backfilled), so an empty result means the fetch
      // failed rather than the reservation genuinely having no items -- fall
      // back to the denormalised parent columns instead of showing nothing.
      const { data: itemRows, error: itemsError } = await supabase
        .from('reservation_items')
        .select('*')
        .eq('reservation_id', id)
        .order('created_at', { ascending: true });
      if (itemsError) throw itemsError;
      setItems(itemRows ?? []);
    } catch (err) {
      console.error('Error fetching reservation:', err);
      setReservation(null);
      setItems([]);
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

  useEffect(() => {
    fetchReservation();
  }, [fetchReservation]);

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

  const generateDates = () => {
    const dates: Date[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const handleReschedule = async () => {
    if (!rescheduleSlot) {
      showToast('Please choose a new appointment time.', 'info');
      return;
    }
    setSubmitting(true);
    try {
      // Server-side reschedule_reservation re-checks slot capacity via the
      // validate_reservation_time trigger.
      const { error } = await supabase.rpc('reschedule_reservation', {
        _reservation_id: id,
        _date: formatLocalDate(rescheduleDate),
        _appointment_time: rescheduleSlot,
      });
      if (error) throw error;
      setShowReschedule(false);
      setRescheduleSlot(undefined);
      await fetchReservation();
      showToast('Your appointment has been updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not reschedule. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Opens the PayMongo checkout for an already-accepted reservation. This is
  // the path that did not exist before: a customer who closed the checkout
  // page had no way back to it, and simply lost the reservation.
  const handlePayNow = async () => {
    if (!id) return;
    setPayBusy(true);
    try {
      const { paymentId, checkoutUrl } = await startReservationPayment(id);
      router.push({
        pathname: '/payment/[paymentId]',
        params: { paymentId, url: checkoutUrl },
      } as any);
    } catch (err: any) {
      showToast(err.message || 'Could not start the payment.', 'error');
    } finally {
      setPayBusy(false);
    }
  };

  // Manual transfer path. Uploading only records the claim -- staff still have
  // to verify it, which is what stops a junk image from holding the item.
  const handleUploadReceipt = async () => {
    const userId = session?.user?.id;
    if (!id || !userId) return;

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
      });
      if (error) throw error;
      await fetchReservation();
      showToast('Receipt sent. We will confirm once it has been checked.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not send the receipt.', 'error');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (statusBucket(status)) {
      case 'pending': return colors.warning;
      case 'toPay': return colors.notification;
      case 'ready': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
    }
  };

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
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = reservation.date
    ? new Date(reservation.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';
  const statusColor = getStatusColor(reservation.status);
  const balanceDue = (reservation.rental_price || 0) - (reservation.deposit || 0);
  // Matches the dashboard's CAN_RESCHEDULE_STATUSES. The old list stopped at
  // 'confirmed', so a customer whose item was already waiting for collection
  // could not move the appointment even though staff could.
  const canRescheduleNow = canReschedule(reservation.status);

  const paymentState = (reservation.payment_status || 'Pending').toLowerCase();
  const reservationState = statusBucket(reservation.status);
  // Payment only opens once staff accept. Before that the customer owes
  // nothing and there is no deadline running.
  const awaitingPayment = isAwaitingPayment(reservation.status) && paymentState === 'pending';
  const receiptUnderReview = paymentState === 'submitted';
  const timeLeft = reservation.payment_due_at ? formatRemaining(reservation.payment_due_at) : null;

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Reservation Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <Text style={[styles.displayId, { color: colors.secondaryText }]}>
            {reservation.display_id || reservation.id.substring(0, 8)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel(reservation.status)}</Text>
          </View>
        </View>

        {/* Gated on 'ready', not 'confirmed'. Stored 'Confirmed' means approved
            and still unpaid, so this was showing a pickup pass to customers who
            owed money and hiding it from the ones who had paid. */}
        {reservationState === 'ready' && (
          <View style={[styles.pickupCard, { backgroundColor: colors.tint }]}>
            <View style={styles.pickupHeader}>
              <IconSymbol name="checkmark.circle.fill" size={18} color={colors.onTint} />
              <Text style={[styles.pickupTitle, { color: colors.onTint }]}>PICKUP PASS</Text>
            </View>
            {reservation.pickup_token && (
              <View style={styles.pickupQrWrap}>
                <QRCode value={`jezsy-pickup:${reservation.pickup_token}`} size={140} backgroundColor="#FFFFFF" color="#0D0D0D" />
              </View>
            )}
            <Text style={[styles.pickupRef, { color: colors.onTint }]}>{reservation.display_id || reservation.id.substring(0, 8)}</Text>
            <Text style={[styles.pickupHint, { color: colors.onTint }]}>
              Show this code at the boutique to collect your item. Bring a valid ID and your remaining balance.
            </Text>
          </View>
        )}

        {displayItems.length > 1 && (
          <Text style={[styles.itemsHeading, { color: colors.secondaryText }]}>
            {displayItems.length} items in this reservation
          </Text>
        )}

        {displayItems.map((item, index) => (
          <View
            key={item.id ?? `${item.product_id}-${index}`}
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
                Size: {item.size || 'Standard'} • Color: {item.color || 'Default'}
                {(item.quantity ?? 1) > 1 ? ` • Qty ${item.quantity}` : ''}
              </Text>
              {item.product_id && (
                <Link href={`/product/${item.product_id}`} asChild>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View ${item.product_name}`}>
                    <Text style={[styles.viewProductLink, { color: colors.tint }]}>View Product</Text>
                  </TouchableOpacity>
                </Link>
              )}
            </View>
          </View>
        ))}

        <TouchableOpacity
          onPress={handleAskAboutReservation}
          accessibilityRole="button"
          accessibilityLabel="Ask the shop owner about this reservation"
          style={styles.askRow}
        >
          <Text style={[styles.viewProductLink, { color: colors.tint }]}>Ask about this reservation</Text>
        </TouchableOpacity>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Appointment</Text>
            {canRescheduleNow && !showReschedule && (
              <TouchableOpacity
                onPress={() => {
                  setRescheduleDate(reservation.date ? new Date(reservation.date) : new Date());
                  setRescheduleSlot(undefined);
                  setShowReschedule(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Reschedule appointment"
                accessibilityHint="Choose a new date and time for this reservation"
              >
                <Text style={[styles.rescheduleLink, { color: colors.tint }]}>Reschedule</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.infoRow, { marginTop: 12 }]}>
            <IconSymbol name="calendar" size={18} color={colors.tint} />
            <Text style={[styles.infoText, { color: colors.text }]}>
              {dateStr} at {formatTimeLabel(reservation.appointment_time)}
            </Text>
          </View>

          {showReschedule && (
            <View style={[styles.reschedulePanel, { borderTopColor: colors.border }]}>
              <Text style={[styles.rescheduleLabel, { color: colors.secondaryText }]}>Select a new date</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {generateDates().map((d, index) => {
                  const isSelected = d.toDateString() === rescheduleDate.toDateString();
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[styles.dateBox, { borderColor: isSelected ? colors.tint : colors.border }, isSelected && { backgroundColor: colors.background }]}
                      onPress={() => { setRescheduleDate(d); setRescheduleSlot(undefined); }}
                      accessibilityRole="button"
                      accessibilityLabel={d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.dayName, { color: isSelected ? colors.tint : colors.secondaryText }]}>
                        {d.toLocaleDateString('en-US', { weekday: 'short' })}
                      </Text>
                      <Text style={[styles.dateNum, { color: isSelected ? colors.tint : colors.text }]}>{d.getDate()}</Text>
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

        {reservationState === 'pending' && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Awaiting review</Text>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Nothing to pay yet. We will let you know once this is accepted, and you
              will then have up to 24 hours to pay ₱{(reservation.deposit || 0).toFixed(2)}
              {' '}(less if your appointment is coming up soon).
            </Text>
          </View>
        )}

        {awaitingPayment && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.tint }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment needed</Text>
            <Text style={[styles.rowText, { color: colors.secondaryText, marginBottom: 12 }]}>
              Your request was accepted. Pay ₱{(reservation.deposit || 0).toFixed(2)} to keep this item.
            </Text>

            {/* The deadline was previously invisible -- the customer was on a
                countdown nobody had told them about. */}
            <View style={[styles.payDeadline, { borderColor: timeLeft ? colors.warning : colors.error }]}>
              <IconSymbol
                name={timeLeft ? 'exclamationmark.circle' : 'xmark'}
                size={16}
                color={timeLeft ? colors.warning : colors.error}
              />
              <Text style={[styles.payDeadlineText, { color: timeLeft ? colors.warning : colors.error }]}>
                {timeLeft ?? 'The payment window has closed.'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.payPrimary, { backgroundColor: colors.tint, opacity: payBusy || uploadingReceipt ? 0.6 : 1 }]}
              onPress={handlePayNow}
              disabled={payBusy || uploadingReceipt}
              accessibilityRole="button"
              accessibilityLabel="Pay with GCash"
              accessibilityState={{ disabled: payBusy || uploadingReceipt }}
            >
              {payBusy ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.payPrimaryText, { color: colors.onTint }]}>Pay with GCash</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.paySecondary, { borderColor: colors.border, opacity: payBusy || uploadingReceipt ? 0.6 : 1 }]}
              onPress={handleUploadReceipt}
              disabled={payBusy || uploadingReceipt}
              accessibilityRole="button"
              accessibilityLabel="Upload payment receipt"
              accessibilityHint="Send proof of a manual transfer for staff to check"
              accessibilityState={{ disabled: payBusy || uploadingReceipt }}
            >
              {uploadingReceipt ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={[styles.paySecondaryText, { color: colors.text }]}>
                  I paid by transfer - upload receipt
                </Text>
              )}
            </TouchableOpacity>
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

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment</Text>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Item Price</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>₱{(reservation.rental_price || 0).toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              {(reservation.payment_type || 'Deposit') === 'Full' ? 'Amount to pay (full)' : 'Reservation Fee (50%)'}
            </Text>
            <Text style={[styles.rowValue, { color: colors.success }]}>₱{(reservation.deposit || 0).toFixed(2)}</Text>
          </View>
          <View style={[styles.row, { marginBottom: 0 }]}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Balance Due at Pickup</Text>
            <Text style={[styles.rowValue, { color: colors.tint }]}>₱{balanceDue.toFixed(2)}</Text>
          </View>
          <View style={[styles.paymentStatusRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Payment Status</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>{reservation.payment_status || 'Pending'}</Text>
          </View>
        </View>

        {reservation.receipt_url && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Receipt</Text>
            {receiptUri ? (
              <Image source={{ uri: receiptUri }} style={styles.receiptImage} contentFit="contain" />
            ) : receiptLoadFailed ? (
              <View style={[styles.receiptImage, styles.receiptPlaceholder]}>
                <IconSymbol name="exclamationmark.circle" size={20} color={colors.error} />
                <Text style={[styles.rowText, { color: colors.error, marginTop: 8 }]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  payDeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 60 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  displayId: { fontSize: 13, fontWeight: '500' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  pickupCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  pickupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pickupTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  pickupQrWrap: { alignSelf: 'center', padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', marginBottom: 16 },
  pickupRef: { fontSize: 28, fontWeight: '900', letterSpacing: 2, marginBottom: 8, textAlign: 'center' },
  pickupHint: { fontSize: 12, lineHeight: 17 },
  productCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  productImage: { width: 100, height: 120 },
  productInfo: { flex: 1, padding: 16, justifyContent: 'center', gap: 4 },
  productName: { fontSize: 16, fontWeight: '700' },
  productDetails: { fontSize: 13 },
  viewProductLink: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  itemsHeading: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  askRow: { marginBottom: 16 },
  sectionCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { fontSize: 15, fontWeight: '500' },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rescheduleLink: { fontSize: 14, fontWeight: '700' },
  reschedulePanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rescheduleLabel: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  dateBox: {
    width: 60,
    height: 68,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dayName: { fontSize: 12, marginBottom: 4 },
  dateNum: { fontSize: 18, fontWeight: '700' },
  rescheduleActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  rescheduleCancel: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescheduleConfirm: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rowText: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '600' },
  paymentStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  receiptImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.08)',
  },
  receiptPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
});
