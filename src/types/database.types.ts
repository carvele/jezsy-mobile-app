export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      notifications: {
        Row: {
          body: string;
          created_at: string;
          data: Json | null;
          id: string;
          is_read: boolean | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_read?: boolean | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_read?: boolean | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          quantity: number | null;
          selected_color: string | null;
          selected_size: string | null;
          unit_price: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          quantity?: number | null;
          selected_color?: string | null;
          selected_size?: string | null;
          unit_price: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_id?: string;
          quantity?: number | null;
          selected_color?: string | null;
          selected_size?: string | null;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      capsules: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          target_count: number | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          target_count?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          target_count?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "capsules_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_items: {
        Row: {
          capsule_id: string;
          wardrobe_item_id: string;
          created_at: string | null;
        };
        Insert: {
          capsule_id: string;
          wardrobe_item_id: string;
          created_at?: string | null;
        };
        Update: {
          capsule_id?: string;
          wardrobe_item_id?: string;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_items_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_items_wardrobe_item_id_fkey";
            columns: ["wardrobe_item_id"];
            isOneToOne: false;
            referencedRelation: "wardrobe_items";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          created_at: string;
          customer_id: string;
          display_id: string;
          id: string;
          payment_intent_id: string | null;
          shipping_address: Json;
          status: string | null;
          total_amount: number;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          display_id: string;
          id?: string;
          payment_intent_id?: string | null;
          shipping_address: Json;
          status?: string | null;
          total_amount: number;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          display_id?: string;
          id?: string;
          payment_intent_id?: string | null;
          shipping_address?: Json;
          status?: string | null;
          total_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          care_instructions: string | null;
          category: string | null;
          color: string | null;
          created_at: string;
          created_by: string | null;
          deleted: boolean | null;
          description: string | null;
          discount_percentage: number | null;
          fit_and_sizing: string | null;
          id: string;
          image_url: string | null;
          images: string[] | null;
          is_alterable: boolean | null;
          is_featured: boolean | null;
          is_new_arrival: boolean | null;
          mask_url: string | null;
          material: string | null;
          measurements: Json | null;
          model_3d_url: string | null;
          name: string;
          occasion: string | null;
          on_sale: boolean | null;
          price: number | null;
          rating: number | null;
          review_count: number | null;
          sale_price: number | null;
          season: string | null;
          sizes: string[] | null;
          status: string | null;
          stock: number | null;
          style_code: string | null;
          sub_category: string | null;
          tags: string[] | null;
          updated_at: string;
          updated_by: string | null;
          visibility: string | null;
        };
        Insert: {
          care_instructions?: string | null;
          category?: string | null;
          color?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted?: boolean | null;
          description?: string | null;
          discount_percentage?: number | null;
          fit_and_sizing?: string | null;
          id?: string;
          image_url?: string | null;
          images?: string[] | null;
          is_alterable?: boolean | null;
          is_featured?: boolean | null;
          is_new_arrival?: boolean | null;
          mask_url?: string | null;
          material?: string | null;
          measurements?: Json | null;
          model_3d_url?: string | null;
          name: string;
          occasion?: string | null;
          on_sale?: boolean | null;
          price?: number | null;
          rating?: number | null;
          review_count?: number | null;
          sale_price?: number | null;
          season?: string | null;
          sizes?: string[] | null;
          status?: string | null;
          stock?: number | null;
          style_code?: string | null;
          sub_category?: string | null;
          tags?: string[] | null;
          updated_at?: string;
          updated_by?: string | null;
          visibility?: string | null;
        };
        Update: {
          care_instructions?: string | null;
          category?: string | null;
          color?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted?: boolean | null;
          description?: string | null;
          discount_percentage?: number | null;
          fit_and_sizing?: string | null;
          id?: string;
          image_url?: string | null;
          images?: string[] | null;
          is_alterable?: boolean | null;
          is_featured?: boolean | null;
          is_new_arrival?: boolean | null;
          mask_url?: string | null;
          material?: string | null;
          measurements?: Json | null;
          model_3d_url?: string | null;
          name?: string;
          occasion?: string | null;
          on_sale?: boolean | null;
          price?: number | null;
          rating?: number | null;
          review_count?: number | null;
          sale_price?: number | null;
          season?: string | null;
          sizes?: string[] | null;
          status?: string | null;
          stock?: number | null;
          style_code?: string | null;
          sub_category?: string | null;
          tags?: string[] | null;
          updated_at?: string;
          updated_by?: string | null;
          visibility?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          address_line: string | null;
          barangay: string | null;
          city: string | null;
          created_at: string;
          date_of_birth: string | null;
          deleted: boolean | null;
          email: string | null;
          expo_push_token: string | null;
          first_name: string | null;
          fit_preference: string | null;
          gender: string | null;
          id: string;
          last_name: string | null;
          phone: string | null;
          province: string | null;
          role: string | null;
          updated_at: string;
          zip_code: string | null;
        };
        Insert: {
          address_line?: string | null;
          barangay?: string | null;
          city?: string | null;
          created_at?: string;
          date_of_birth?: string | null;
          deleted?: boolean | null;
          email?: string | null;
          expo_push_token?: string | null;
          first_name?: string | null;
          fit_preference?: string | null;
          gender?: string | null;
          id: string;
          last_name?: string | null;
          phone?: string | null;
          province?: string | null;
          role?: string | null;
          updated_at?: string;
          zip_code?: string | null;
        };
        Update: {
          address_line?: string | null;
          barangay?: string | null;
          city?: string | null;
          created_at?: string;
          date_of_birth?: string | null;
          deleted?: boolean | null;
          email?: string | null;
          expo_push_token?: string | null;
          first_name?: string | null;
          fit_preference?: string | null;
          gender?: string | null;
          id?: string;
          last_name?: string | null;
          phone?: string | null;
          province?: string | null;
          role?: string | null;
          updated_at?: string;
          zip_code?: string | null;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          appointment_time: string | null;
          assigned_staff_id: string | null;
          color: string | null;
          countdown: boolean | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          date: string | null;
          deleted: boolean | null;
          deposit: number | null;
          display_id: string | null;
          hidden_in_cancelled: boolean | null;
          hidden_in_history: boolean | null;
          id: string;
          image_url: string | null;
          payment_status: string | null;
          payment_type: string | null;
          product_id: string | null;
          product_name: string | null;
          quantity: number | null;
          receipt_url: string | null;
          payment_receipt_url: string | null;
          rental_price: number | null;
          return_date: string | null;
          size: string | null;
          staff_id: string | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          appointment_time?: string | null;
          assigned_staff_id?: string | null;
          color?: string | null;
          countdown?: boolean | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          date?: string | null;
          deleted?: boolean | null;
          deposit?: number | null;
          display_id?: string | null;
          hidden_in_cancelled?: boolean | null;
          hidden_in_history?: boolean | null;
          id?: string;
          image_url?: string | null;
          payment_status?: string | null;
          payment_type?: string | null;
          product_id?: string | null;
          product_name?: string | null;
          quantity?: number | null;
          receipt_url?: string | null;
          payment_receipt_url?: string | null;
          rental_price?: number | null;
          return_date?: string | null;
          size?: string | null;
          staff_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          appointment_time?: string | null;
          assigned_staff_id?: string | null;
          color?: string | null;
          countdown?: boolean | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          date?: string | null;
          deleted?: boolean | null;
          deposit?: number | null;
          display_id?: string | null;
          hidden_in_cancelled?: boolean | null;
          hidden_in_history?: boolean | null;
          id?: string;
          image_url?: string | null;
          payment_status?: string | null;
          payment_type?: string | null;
          product_id?: string | null;
          product_name?: string | null;
          quantity?: number | null;
          receipt_url?: string | null;
          payment_receipt_url?: string | null;
          rental_price?: number | null;
          return_date?: string | null;
          size?: string | null;
          staff_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservations_assigned_staff_id_fkey";
            columns: ["assigned_staff_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      store_closures: {
        Row: {
          closure_date: string;
          custom_close_time: string | null;
          custom_open_time: string | null;
          is_fully_closed: boolean | null;
          reason: string | null;
        };
        Insert: {
          closure_date: string;
          custom_close_time?: string | null;
          custom_open_time?: string | null;
          is_fully_closed?: boolean | null;
          reason?: string | null;
        };
        Update: {
          closure_date?: string;
          custom_close_time?: string | null;
          custom_open_time?: string | null;
          is_fully_closed?: boolean | null;
          reason?: string | null;
        };
        Relationships: [];
      };
      store_hours: {
        Row: {
          close_time: string;
          day_of_week: number;
          is_closed: boolean | null;
          open_time: string;
        };
        Insert: {
          close_time: string;
          day_of_week: number;
          is_closed?: boolean | null;
          open_time: string;
        };
        Update: {
          close_time?: string;
          day_of_week?: number;
          is_closed?: boolean | null;
          open_time?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string;
          images: string[] | null;
          product_id: string;
          rating: number;
          user_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          images?: string[] | null;
          product_id: string;
          rating: number;
          user_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          images?: string[] | null;
          product_id?: string;
          rating?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_outfits: {
        Row: {
          created_at: string;
          deleted: boolean | null;
          id: string;
          items: Json | null;
          name: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          deleted?: boolean | null;
          id?: string;
          items?: Json | null;
          name?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          deleted?: boolean | null;
          id?: string;
          items?: Json | null;
          name?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_outfits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_measurements: {
        Row: {
          created_at: string;
          height: number | null;
          id: string;
          measurement_source: string | null;
          measurements: Json | null;
          scan_confidence: number | null;
          per_field_confidence: Json | null;
          scanned_at: string | null;
          user_id: string;
          weight: number | null;
        };
        Insert: {
          created_at?: string;
          height?: number | null;
          id?: string;
          measurement_source?: string | null;
          measurements?: Json | null;
          scan_confidence?: number | null;
          per_field_confidence?: Json | null;
          scanned_at?: string | null;
          user_id: string;
          weight?: number | null;
        };
        Update: {
          created_at?: string;
          height?: number | null;
          id?: string;
          measurement_source?: string | null;
          measurements?: Json | null;
          scan_confidence?: number | null;
          per_field_confidence?: Json | null;
          scanned_at?: string | null;
          user_id?: string;
          weight?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_measurements_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_streaks: {
        Row: {
          user_id: string;
          current_streak: number | null;
          longest_streak: number | null;
          last_action_date: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          user_id: string;
          current_streak?: number | null;
          longest_streak?: number | null;
          last_action_date?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          user_id?: string;
          current_streak?: number | null;
          longest_streak?: number | null;
          last_action_date?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_streaks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      wardrobe_items: {
        Row: {
          category: string | null;
          color_tags: string[] | null;
          created_at: string;
          deleted: boolean | null;
          id: string;
          image_url: string | null;
          product_id: string | null;
          sub_category: string | null;
          user_id: string | null;
        };
        Insert: {
          category?: string | null;
          color_tags?: string[] | null;
          created_at?: string;
          deleted?: boolean | null;
          id?: string;
          image_url?: string | null;
          product_id?: string | null;
          sub_category?: string | null;
          user_id?: string | null;
        };
        Update: {
          category?: string | null;
          color_tags?: string[] | null;
          created_at?: string;
          deleted?: boolean | null;
          id?: string;
          image_url?: string | null;
          product_id?: string | null;
          sub_category?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "wardrobe_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wardrobe_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      wishlists: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlists_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      check_email_exists: { Args: { lookup_email: string }; Returns: boolean };
      create_order: {
        Args: { _shipping_address: Json; _items: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
