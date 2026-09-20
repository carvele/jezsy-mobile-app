export interface ReservationItemInput {
  product_id: string;
  size?: string | null;
  color?: string | null;
  quantity: number;
}

export interface CreateReservationInput {
  items: ReservationItemInput[];
  date: string | null;
  appointmentTime: string | null;
  paymentOption: string;
  receiptPath?: string | null;
}

export interface ReservationResult {
  display_id: string;
  rental_price: number;
  [key: string]: unknown;
}
