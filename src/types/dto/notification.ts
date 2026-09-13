export type NotificationEntityType =
  | 'reservation'
  | 'product'
  | 'conversation'
  | 'direct_chat'
  | 'review'
  | 'announcement'
  | 'system';

export type NotificationAction =
  | 'status_changed'
  | 'payment_received'
  | 'payment_rejected'
  | 'payment_deadline'
  | 'back_in_stock'
  | 'new_message'
  | 'review_reply'
  | 'staff_broadcast'
  | 'announcement';

export interface NotificationData {
  entity_type?: NotificationEntityType;
  entity_id?: string;
  action?: NotificationAction;

  // Backward-compatibility entity keys
  reservation_id?: string;
  product_id?: string;
  conversation_id?: string;
  direct_chat_id?: string;
  review_id?: string;
  announcement_id?: string;

  // Domain presentation metadata
  display_id?: string;
  status?: string;
  size?: string;
  amount?: number;
  fully_paid?: boolean;
  payment_status?: string;
  payment_issue?: string;
  actor_id?: string;
  actor_name?: string;

  // Explicit deep link route (fallback)
  deep_link?: string;
  image_url?: string;
  metadata?: Record<string, unknown>;
}

export type NotificationKind = 'personal' | 'announcement';

export interface AppNotification {
  id: string;
  user_id?: string;
  type: string;
  title: string;
  body: string;
  data?: NotificationData | null;
  created_at: string;
  is_read?: boolean | null;
  kind: NotificationKind;
}
