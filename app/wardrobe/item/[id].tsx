import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useToast } from '@/src/context/ToastContext';
import { useAuth } from '@/src/context/AuthContext';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import {
  normalizeGarment,
  resolveEffectiveGarmentBucket,
} from '@/src/utils/garmentSemanticClassifier';
import { wardrobeService } from '@/src/services/wardrobeService';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function WardrobeItemDetailScreen() {
  const { showToast } = useToast();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [item, setItem] = useState<WardrobeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editCategory, setEditCategory] = useState('');
  const [editSubCategory, setEditSubCategory] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editWhereWorn, setEditWhereWorn] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editUserNotes, setEditUserNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (data) {
        const effective = resolveEffectiveGarmentBucket(data);
        if (effective !== data.garment_type && (data.garment_type === 'Top' || !data.garment_type)) {
          supabase
            .from('wardrobe_items')
            .update({ garment_type: effective })
            .eq('id', data.id)
            .then(({ error: updateErr }) => {
              if (updateErr) {
                console.warn('Could not auto-heal wardrobe item bucket:', updateErr);
              }
            });
          data.garment_type = effective;
        }
        setItem(data);
      } else {
        setItem(null);
      }
    } catch (err) {
      console.error('Error fetching wardrobe item:', err);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleLogWear = async () => {
    if (!item) return;
    setLogging(true);
    try {
      const { data, error } = await supabase.rpc('increment_wear_count', { p_item_id: item.id });
      if (error) throw error;
      setItem(data);
      showToast('Wear logged for today.', 'success');
    } catch (err) {
      console.error('Error logging wear:', err);
      showToast('Could not log this wear. Please try again.', 'error');
    } finally {
      setLogging(false);
    }
  };

  const executeDelete = async () => {
    if (!item) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('wardrobe_items')
        .update({ deleted: true })
        .eq('id', item.id);
      if (error) throw error;
      showToast('Item removed from wardrobe.', 'info');
      router.back();
    } catch (err) {
      console.error('Error deleting wardrobe item:', err);
      showToast('Could not remove this item. Please try again.', 'error');
      setDeleting(false);
    }
  };

  // Authoritative extraction of user fields
  const rawColorText = useMemo(() => {
    if (!item) return '';
    const fromAi = (item as any)?.ai_attributes?.rawColor;
    if (fromAi) return String(fromAi);
    if (item.color_tags && item.color_tags.length > 0) return item.color_tags.join(', ');
    return '';
  }, [item]);

  const rawWhereWornText = useMemo(() => {
    if (!item) return '';
    const fromAi = (item as any)?.ai_attributes?.whereWornOften;
    if (fromAi) return String(fromAi);
    const occ = (item as any)?.occasions;
    if (Array.isArray(occ) && occ.length > 0) return occ.join(', ');
    return '';
  }, [item]);

  const rawDescriptionText = useMemo(() => {
    if (!item) return '';
    return item.description || (item as any)?.ai_attributes?.description || '';
  }, [item]);

  const rawUserNotesText = useMemo(() => {
    if (!item) return '';
    return item.user_notes || (item as any)?.ai_attributes?.userNotes || '';
  }, [item]);

  // Open Edit Modal with initialized values
  const openEditModal = () => {
    if (!item) return;
    setEditCategory(item.category || '');
    setEditSubCategory(item.sub_category || '');
    setEditColor(rawColorText);
    setEditWhereWorn(rawWhereWornText);
    setEditDescription(rawDescriptionText);
    setEditUserNotes(rawUserNotesText);
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!item || !session?.user?.id) return;
    const trimmedCategory = editCategory.trim();
    const trimmedDesc = editDescription.trim();

    if (!trimmedCategory && !trimmedDesc) {
      showToast('Please provide a category or description.', 'error');
      return;
    }

    setEditSaving(true);
    try {
      const result = await wardrobeService.updateItem(item.id, session.user.id, {
        category: trimmedCategory || 'Clothing',
        subCategory: editSubCategory.trim() || null,
        color: editColor.trim() || null,
        whereWornOften: editWhereWorn.trim() || null,
        description: trimmedDesc || null,
        userNotes: editUserNotes.trim() || null,
      });

      if (!result.ok) {
        throw result.error;
      }

      setItem(result.data);
      setEditModalVisible(false);
      showToast('Garment details updated.', 'success');
    } catch (err: any) {
      console.error('Error updating wardrobe item:', err);
      showToast(err?.message || 'Failed to update garment details.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Item not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const effectiveGarmentType = resolveEffectiveGarmentBucket(item);

  // Derive semantic information using authoritative user text (fixing where-worn resolution bug)
  const normalized = normalizeGarment(
    item.category || '',
    item.sub_category || '',
    rawColorText,
    rawWhereWornText,
    rawDescriptionText,
    rawUserNotesText
  );

  const wearLabel =
    item.wear_count === 0
      ? 'Never worn'
      : `Worn ${item.wear_count} time${item.wear_count === 1 ? '' : 's'}${item.last_worn_at ? ` · last worn ${timeAgo(item.last_worn_at)}` : ''}`;

  const hasStyleProfile = Boolean(
    (item as any).pattern ||
    (item as any).material ||
    (item as any).fit ||
    ((item as any).occasions && (item as any).occasions.length > 0) ||
    ((item as any).seasons && (item as any).seasons.length > 0)
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Item Details</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={openEditModal}
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Edit item details"
          >
            <IconSymbol name="pencil" size={20} color={colors.tint} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setConfirmDeleteVisible(true)}
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete this item"
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.notification} />
            ) : (
              <IconSymbol name="trash.fill" size={20} color={colors.notification} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ConfirmModal
        visible={confirmDeleteVisible}
        title="Remove Item"
        message="Remove this item from your digital wardrobe?"
        confirmLabel="Remove"
        onCancel={() => setConfirmDeleteVisible(false)}
        onConfirm={() => {
          setConfirmDeleteVisible(false);
          executeDelete();
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Garment Image */}
        <Image
          source={{ uri: item.image_url || undefined }}
          style={[styles.image, { backgroundColor: colors.card }]}
          contentFit="contain"
        />

        {/* Identity & Bucket Badges */}
        <View style={styles.identitySection}>
          <View style={styles.tagsRow}>
            {effectiveGarmentType ? (
              <View style={[styles.bucketTag, { backgroundColor: colors.tint }]}>
                <Text style={[styles.bucketTagText, { color: colors.onTint }]}>
                  {effectiveGarmentType.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {item.category ? (
              <View style={[styles.subtleTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.subtleTagText, { color: colors.secondaryText }]}>
                  Category: <Text style={{ color: colors.text, fontWeight: '600' }}>{item.category}</Text>
                </Text>
              </View>
            ) : null}
          </View>

          {item.sub_category ? (
            <Text style={[styles.subCategoryTitle, { color: colors.text }]}>
              {item.sub_category}
            </Text>
          ) : null}
        </View>

        {/* User's Authoritative Information Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="tshirt" size={16} color={colors.tint} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>My Garment Details</Text>
          </View>

          {/* Color */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>COLOR</Text>
            <Text style={[styles.fieldValue, { color: colors.text }]}>
              {rawColorText || 'Not specified'}
            </Text>
            {item.color_tags && item.color_tags.length > 0 && (
              <View style={styles.colorChipsRow}>
                {item.color_tags.map((c) => (
                  <View key={c} style={[styles.colorChip, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <Text style={[styles.colorChipText, { color: colors.text }]}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Where I Wear This */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>WHERE I WEAR THIS</Text>
            <Text style={[styles.fieldValue, { color: colors.text }]}>
              {rawWhereWornText || 'Not specified'}
            </Text>
          </View>

          {/* Description */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>DESCRIPTION</Text>
            <Text style={[styles.fieldValue, styles.descriptionText, { color: colors.text }]}>
              {rawDescriptionText || 'No description provided'}
            </Text>
          </View>

          {/* Personal Notes (Shown only if present) */}
          {rawUserNotesText ? (
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>PERSONAL NOTES</Text>
              <Text style={[styles.fieldValue, styles.notesText, { color: colors.text }]}>
                {rawUserNotesText}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Derived JeZsy Classification Card (Clearly labeled as system-derived) */}
        <View style={[styles.card, styles.classificationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="sparkles" size={16} color={colors.tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.tint }]}>JeZsy Classification</Text>
              <Text style={[styles.cardSubtitle, { color: colors.secondaryText }]}>
                Derived fashion intelligence for styling and mannequin
              </Text>
            </View>
          </View>

          <View style={styles.attrGrid}>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Garment Family</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>{normalized.family}</Text>
            </View>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Garment Type</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>{normalized.type || 'Standard'}</Text>
            </View>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Subtype</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>{normalized.subtype || 'Standard'}</Text>
            </View>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Style</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>
                {normalized.style.length > 0 ? normalized.style.join(' · ') : 'Standard'}
              </Text>
            </View>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Activity</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>
                {normalized.activity.length > 0 ? normalized.activity.join(' · ') : 'General'}
              </Text>
            </View>
            <View style={styles.attrItem}>
              <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Material</Text>
              <Text style={[styles.attrValue, { color: colors.text }]}>
                {normalized.material.length > 0 ? normalized.material.join(' · ') : ((item as any).material || 'Not specified')}
              </Text>
            </View>
          </View>
        </View>

        {/* Style Profile Card (Only if actual values exist) */}
        {hasStyleProfile && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <IconSymbol name="tag.fill" size={16} color={colors.tint} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Style Profile</Text>
            </View>
            <View style={styles.attrGrid}>
              {(item as any).pattern && (
                <View style={styles.attrItem}>
                  <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Pattern</Text>
                  <Text style={[styles.attrValue, { color: colors.text }]}>{(item as any).pattern}</Text>
                </View>
              )}
              {(item as any).material && (
                <View style={styles.attrItem}>
                  <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Material</Text>
                  <Text style={[styles.attrValue, { color: colors.text }]}>{(item as any).material}</Text>
                </View>
              )}
              {(item as any).fit && (
                <View style={styles.attrItem}>
                  <Text style={[styles.attrLabel, { color: colors.secondaryText }]}>Fit</Text>
                  <Text style={[styles.attrValue, { color: colors.text }]}>{(item as any).fit}</Text>
                </View>
              )}
            </View>

            {(item as any).occasions && (item as any).occasions.length > 0 && (
              <View style={styles.occasionsContainer}>
                <Text style={[styles.attrLabel, { color: colors.secondaryText, marginBottom: 6 }]}>Occasions</Text>
                <View style={styles.chipRow}>
                  {((item as any).occasions as string[]).map((occ: string) => (
                    <View key={occ} style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[styles.chipText, { color: colors.text }]}>{occ}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {(item as any).seasons && (item as any).seasons.length > 0 && (
              <View style={styles.occasionsContainer}>
                <Text style={[styles.attrLabel, { color: colors.secondaryText, marginBottom: 6 }]}>Seasons</Text>
                <View style={styles.chipRow}>
                  {((item as any).seasons as string[]).map((season: string) => (
                    <View key={season} style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[styles.chipText, { color: colors.text }]}>{season}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Item Information & Wear History */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="chart.bar.fill" size={16} color={colors.tint} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Item History & Metadata</Text>
          </View>
          <View style={styles.metadataList}>
            <View style={styles.metadataRow}>
              <Text style={[styles.metadataLabel, { color: colors.secondaryText }]}>Wear Activity</Text>
              <Text style={[styles.metadataValue, { color: colors.text }]}>{wearLabel}</Text>
            </View>
            <View style={styles.metadataRow}>
              <Text style={[styles.metadataLabel, { color: colors.secondaryText }]}>Date Added</Text>
              <Text style={[styles.metadataValue, { color: colors.text }]}>{formatDate(item.created_at)}</Text>
            </View>
            {item.last_worn_at && (
              <View style={styles.metadataRow}>
                <Text style={[styles.metadataLabel, { color: colors.secondaryText }]}>Last Logged Wear</Text>
                <Text style={[styles.metadataValue, { color: colors.text }]}>{formatDate(item.last_worn_at)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.styleBtn, { borderColor: colors.tint }]}
            onPress={() => router.push('/style-advisor' as any)}
            accessibilityRole="button"
            accessibilityLabel="Style this piece with AI"
          >
            <IconSymbol name="sparkles" size={16} color={colors.tint} />
            <Text style={[styles.styleBtnText, { color: colors.tint }]}>Style This Piece with AI</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.logButton, { backgroundColor: colors.tint, opacity: logging ? 0.6 : 1 }]}
            onPress={handleLogWear}
            disabled={logging}
            accessibilityRole="button"
            accessibilityLabel="Log a wear for this item"
          >
            {logging ? (
              <ActivityIndicator color={colors.onTint} size="small" />
            ) : (
              <>
                <IconSymbol name="checkmark" size={18} color={colors.onTint} />
                <Text style={[styles.logButtonText, { color: colors.onTint }]}>Log Wear (Wearing Today)</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Item Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => !editSaving && setEditModalVisible(false)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                disabled={editSaving}
                style={styles.modalHeaderBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel edit"
              >
                <Text style={[styles.modalCancelText, { color: colors.secondaryText }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.modalHeaderTitle, { color: colors.text }]}>Edit Garment</Text>
              <TouchableOpacity
                onPress={handleSaveEdit}
                disabled={editSaving}
                style={[styles.modalSaveBtn, { backgroundColor: colors.tint, opacity: editSaving ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Save changes"
              >
                {editSaving ? (
                  <ActivityIndicator size="small" color={colors.onTint} />
                ) : (
                  <Text style={[styles.modalSaveBtnText, { color: colors.onTint }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {/* Category */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Category</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Dress, Clothing"
                  placeholderTextColor={colors.secondaryText}
                  value={editCategory}
                  onChangeText={setEditCategory}
                  editable={!editSaving}
                />
              </View>

              {/* Sub Category */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Sub Category</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Maxi Dress, Running Shorts"
                  placeholderTextColor={colors.secondaryText}
                  value={editSubCategory}
                  onChangeText={setEditSubCategory}
                  editable={!editSaving}
                />
              </View>

              {/* Color */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Color</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Navy Blue, White & Gold"
                  placeholderTextColor={colors.secondaryText}
                  value={editColor}
                  onChangeText={setEditColor}
                  editable={!editSaving}
                />
              </View>

              {/* Where do you wear this often? */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Where do you wear this often?</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Casual, running, work, gym, date night"
                  placeholderTextColor={colors.secondaryText}
                  value={editWhereWorn}
                  onChangeText={setEditWhereWorn}
                  editable={!editSaving}
                />
              </View>

              {/* Description */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Description</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Describe your item"
                  placeholderTextColor={colors.secondaryText}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  multiline
                  numberOfLines={4}
                  maxLength={2000}
                  editable={!editSaving}
                />
              </View>

              {/* Personal Notes */}
              <View style={styles.formRow}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Personal Notes (Optional)</Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, styles.notesArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Bought for marathon training."
                  placeholderTextColor={colors.secondaryText}
                  value={editUserNotes}
                  onChangeText={setEditUserNotes}
                  multiline
                  numberOfLines={3}
                  maxLength={2000}
                  editable={!editSaving}
                />
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  headerBtn: { padding: Spacing.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { ...Type.subtitle, fontWeight: '700' },
  content: { padding: Spacing.xl, paddingBottom: 60, gap: Spacing.lg },
  image: {
    width: '100%',
    height: 380,
    borderRadius: Radius.lg,
  },
  identitySection: {
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bucketTag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.lg,
  },
  bucketTagText: {
    ...Type.caption,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtleTag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  subtleTagText: {
    ...Type.caption,
  },
  subCategoryTitle: {
    ...Type.title,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
  },
  classificationCard: {
    borderLeftWidth: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardTitle: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  cardSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  fieldBlock: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  fieldValue: {
    ...Type.body,
    fontWeight: '500',
    lineHeight: 22,
  },
  descriptionText: {
    lineHeight: 22,
  },
  notesText: {
    fontStyle: 'italic',
    lineHeight: 22,
  },
  colorChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 4,
  },
  colorChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  colorChipText: {
    ...Type.caption,
    fontWeight: '600',
  },
  attrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  attrItem: {
    minWidth: '45%',
    flex: 1,
  },
  attrLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  attrValue: {
    ...Type.body,
    fontWeight: '600',
  },
  occasionsContainer: {
    marginTop: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  metadataList: {
    gap: Spacing.sm,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metadataLabel: {
    ...Type.caption,
    fontWeight: '500',
  },
  metadataValue: {
    ...Type.caption,
    fontWeight: '700',
  },
  actionsContainer: {
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  styleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  styleBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    borderRadius: Radius.pill,
  },
  logButtonText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150, 150, 150, 0.15)',
  },
  modalHeaderBtn: {
    padding: Spacing.xs,
  },
  modalCancelText: {
    ...Type.body,
    fontWeight: '600',
  },
  modalHeaderTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  modalSaveBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  modalContent: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  formRow: {
    gap: Spacing.xs,
  },
  formLabel: {
    ...Type.body,
    fontWeight: '600',
  },
  input: {
    minHeight: 50,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    ...Type.bodyStrong,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  notesArea: {
    height: 80,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
});
