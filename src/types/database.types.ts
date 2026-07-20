export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ar_assets: {
        Row: {
          created_at: string | null
          id: string
          model_url: string | null
          product_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          model_url?: string | null
          product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          model_url?: string | null
          product_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_assets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_sessions: {
        Row: {
          created_at: string | null
          duration: number | null
          id: string
          product_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          duration?: number | null
          id?: string
          product_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          duration?: number | null
          id?: string
          product_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capsule_items: {
        Row: {
          capsule_id: string
          created_at: string | null
          wardrobe_item_id: string
        }
        Insert: {
          capsule_id: string
          created_at?: string | null
          wardrobe_item_id: string
        }
        Update: {
          capsule_id?: string
          created_at?: string | null
          wardrobe_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capsule_items_capsule_id_fkey"
            columns: ["capsule_id"]
            isOneToOne: false
            referencedRelation: "capsules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capsule_items_wardrobe_item_id_fkey"
            columns: ["wardrobe_item_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_items"
            referencedColumns: ["id"]
          },
        ]
      }
      capsules: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          target_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          target_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          target_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capsules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          slug: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      color_list: {
        Row: {
          created_at: string | null
          id: number
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      color_options: {
        Row: {
          border: string | null
          hex: string
          name: string
          sort_order: number | null
        }
        Insert: {
          border?: string | null
          hex: string
          name: string
          sort_order?: number | null
        }
        Update: {
          border?: string | null
          hex?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string
          last_message: string | null
          last_message_time: string | null
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          last_message?: string | null
          last_message_time?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          last_message?: string | null
          last_message_time?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string | null
          failed_attempts: number | null
          fingerprint: string
          last_seen: string | null
          lockout_until: string | null
          login_history: Json | null
          name: string | null
          staff_email: string | null
          staff_name: string | null
          status: string | null
          updated_at: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string | null
          failed_attempts?: number | null
          fingerprint: string
          last_seen?: string | null
          lockout_until?: string | null
          login_history?: Json | null
          name?: string | null
          staff_email?: string | null
          staff_name?: string | null
          status?: string | null
          updated_at?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string | null
          failed_attempts?: number | null
          fingerprint?: string
          last_seen?: string | null
          lockout_until?: string | null
          login_history?: Json | null
          name?: string | null
          staff_email?: string | null
          staff_name?: string | null
          status?: string | null
          updated_at?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string | null
          id: string
          rating: number | null
          text: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          rating?: number | null
          text?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          rating?: number | null
          text?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          adjusted_score: number | null
          available: number | null
          category: string | null
          created_at: string | null
          deleted: boolean | null
          deleted_at: string | null
          demand_score: number | null
          demand_scored_at: string | null
          id: string
          item: string | null
          product_doc_id: string | null
          reserved: number | null
          size: string | null
          sku: string | null
          stock_tier: string | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          adjusted_score?: number | null
          available?: number | null
          category?: string | null
          created_at?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          demand_score?: number | null
          demand_scored_at?: string | null
          id?: string
          item?: string | null
          product_doc_id?: string | null
          reserved?: number | null
          size?: string | null
          sku?: string | null
          stock_tier?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          adjusted_score?: number | null
          available?: number | null
          category?: string | null
          created_at?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          demand_score?: number | null
          demand_scored_at?: string | null
          id?: string
          item?: string | null
          product_doc_id?: string | null
          reserved?: number | null
          size?: string | null
          sku?: string | null
          stock_tier?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_doc_id_fkey"
            columns: ["product_doc_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          action: string | null
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
          timestamp: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          timestamp?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          timestamp?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          image_url: string | null
          read_at: string | null
          sender_id: string | null
          sender_name: string | null
          text: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          text?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          id: string
          is_read: boolean | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          quantity: number | null
          selected_color: string | null
          selected_size: string | null
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          quantity?: number | null
          selected_color?: string | null
          selected_size?: string | null
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number | null
          selected_color?: string | null
          selected_size?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_id: string
          display_id: string
          id: string
          payment_intent_id: string | null
          shipping_address: Json
          status: string | null
          total_amount: number
        }
        Insert: {
          created_at?: string
          customer_id: string
          display_id: string
          id?: string
          payment_intent_id?: string | null
          shipping_address: Json
          status?: string | null
          total_amount: number
        }
        Update: {
          created_at?: string
          customer_id?: string
          display_id?: string
          id?: string
          payment_intent_id?: string | null
          shipping_address?: Json
          status?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_list: {
        Row: {
          created_at: string | null
          id: number
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pose_guides: {
        Row: {
          category: string
          created_at: string | null
          deleted: boolean | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          deleted?: boolean | null
          id: string
          name: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          base_color: string | null
          care_instructions: string | null
          category: string | null
          color: string | null
          created_at: string
          created_by: string | null
          dateadded: string | null
          deleted: boolean | null
          deleted_at: string | null
          description: string | null
          discount_percentage: number | null
          fit_and_sizing: string | null
          id: string
          image_url: string | null
          images: string[] | null
          is_alterable: boolean | null
          is_featured: boolean | null
          is_new_arrival: boolean | null
          mask_url: string | null
          material: string | null
          measurements: Json | null
          model_3d_url: string | null
          name: string
          occasion: string | null
          on_sale: boolean | null
          pattern: string | null
          price: number | null
          rating: number | null
          review_count: number | null
          sale_price: number | null
          season: string | null
          sizes: string[] | null
          status: string | null
          stock: number | null
          stockbaseline: number | null
          style_code: string | null
          sub_category: string | null
          tags: string[] | null
          updated_at: string
          updated_by: string | null
          visibility: string | null
        }
        Insert: {
          base_color?: string | null
          care_instructions?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          dateadded?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          fit_and_sizing?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          is_alterable?: boolean | null
          is_featured?: boolean | null
          is_new_arrival?: boolean | null
          mask_url?: string | null
          material?: string | null
          measurements?: Json | null
          model_3d_url?: string | null
          name: string
          occasion?: string | null
          on_sale?: boolean | null
          pattern?: string | null
          price?: number | null
          rating?: number | null
          review_count?: number | null
          sale_price?: number | null
          season?: string | null
          sizes?: string[] | null
          status?: string | null
          stock?: number | null
          stockbaseline?: number | null
          style_code?: string | null
          sub_category?: string | null
          tags?: string[] | null
          updated_at?: string
          updated_by?: string | null
          visibility?: string | null
        }
        Update: {
          base_color?: string | null
          care_instructions?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          dateadded?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          fit_and_sizing?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          is_alterable?: boolean | null
          is_featured?: boolean | null
          is_new_arrival?: boolean | null
          mask_url?: string | null
          material?: string | null
          measurements?: Json | null
          model_3d_url?: string | null
          name?: string
          occasion?: string | null
          on_sale?: boolean | null
          pattern?: string | null
          price?: number | null
          rating?: number | null
          review_count?: number | null
          sale_price?: number | null
          season?: string | null
          sizes?: string[] | null
          status?: string | null
          stock?: number | null
          stockbaseline?: number | null
          style_code?: string | null
          sub_category?: string | null
          tags?: string[] | null
          updated_at?: string
          updated_by?: string | null
          visibility?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line: string | null
          barangay: string | null
          city: string | null
          created_at: string
          date_of_birth: string | null
          deleted: boolean | null
          email: string | null
          employment_status: string | null
          expo_push_token: string | null
          first_name: string | null
          fit_preference: string | null
          gender: string | null
          id: string
          is_blocked: boolean | null
          last_name: string | null
          phone: string | null
          province: string | null
          role: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address_line?: string | null
          barangay?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted?: boolean | null
          email?: string | null
          employment_status?: string | null
          expo_push_token?: string | null
          first_name?: string | null
          fit_preference?: string | null
          gender?: string | null
          id: string
          is_blocked?: boolean | null
          last_name?: string | null
          phone?: string | null
          province?: string | null
          role?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address_line?: string | null
          barangay?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted?: boolean | null
          email?: string | null
          employment_status?: string | null
          expo_push_token?: string | null
          first_name?: string | null
          fit_preference?: string | null
          gender?: string | null
          id?: string
          is_blocked?: boolean | null
          last_name?: string | null
          phone?: string | null
          province?: string | null
          role?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      reservations: {
        Row: {
          appointment_time: string | null
          assigned_staff_id: string | null
          color: string | null
          countdown: boolean | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          date: string | null
          deleted: boolean | null
          deposit: number | null
          display_id: string | null
          hidden_in_cancelled: boolean | null
          hidden_in_history: boolean | null
          id: string
          image_url: string | null
          payment_status: string | null
          payment_type: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          receipt_url: string | null
          rental_price: number | null
          return_date: string | null
          size: string | null
          staff_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          appointment_time?: string | null
          assigned_staff_id?: string | null
          color?: string | null
          countdown?: boolean | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          date?: string | null
          deleted?: boolean | null
          deposit?: number | null
          display_id?: string | null
          hidden_in_cancelled?: boolean | null
          hidden_in_history?: boolean | null
          id?: string
          image_url?: string | null
          payment_status?: string | null
          payment_type?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          receipt_url?: string | null
          rental_price?: number | null
          return_date?: string | null
          size?: string | null
          staff_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          appointment_time?: string | null
          assigned_staff_id?: string | null
          color?: string | null
          countdown?: boolean | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          date?: string | null
          deleted?: boolean | null
          deposit?: number | null
          display_id?: string | null
          hidden_in_cancelled?: boolean | null
          hidden_in_history?: boolean | null
          id?: string
          image_url?: string | null
          payment_status?: string | null
          payment_type?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          receipt_url?: string | null
          rental_price?: number | null
          return_date?: string | null
          size?: string | null
          staff_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          images: string[] | null
          product_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          images?: string[] | null
          product_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          images?: string[] | null
          product_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_outfits: {
        Row: {
          created_at: string
          deleted: boolean | null
          id: string
          items: Json | null
          name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted?: boolean | null
          id?: string
          items?: Json | null
          name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted?: boolean | null
          id?: string
          items?: Json | null
          name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_outfits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      staff_status_history: {
        Row: {
          change_type: string
          changed_by: string
          created_at: string
          effective_date: string
          id: string
          new_value: string
          note: string | null
          previous_value: string | null
          staff_id: string
        }
        Insert: {
          change_type: string
          changed_by: string
          created_at?: string
          effective_date?: string
          id?: string
          new_value: string
          note?: string | null
          previous_value?: string | null
          staff_id: string
        }
        Update: {
          change_type?: string
          changed_by?: string
          created_at?: string
          effective_date?: string
          id?: string
          new_value?: string
          note?: string | null
          previous_value?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_status_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          change_type: string
          created_at: string
          delta: number
          id: string
          new_stock: number
          note: string | null
          previous_stock: number
          product_id: string
          updated_at: string
        }
        Insert: {
          change_type: string
          created_at?: string
          delta: number
          id?: string
          new_stock: number
          note?: string | null
          previous_stock: number
          product_id: string
          updated_at?: string
        }
        Update: {
          change_type?: string
          created_at?: string
          delta?: number
          id?: string
          new_stock?: number
          note?: string | null
          previous_stock?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suggested_outfits: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          items: Json | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          items?: Json | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          items?: Json | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_measurements: {
        Row: {
          created_at: string
          height: number | null
          id: string
          measurement_source: string | null
          measurements: Json | null
          per_field_confidence: Json | null
          scan_confidence: number | null
          scanned_at: string | null
          user_id: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          id?: string
          measurement_source?: string | null
          measurements?: Json | null
          per_field_confidence?: Json | null
          scan_confidence?: number | null
          scanned_at?: string | null
          user_id: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          id?: string
          measurement_source?: string | null
          measurements?: Json | null
          per_field_confidence?: Json | null
          scan_confidence?: number | null
          scanned_at?: string | null
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_measurements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_streaks: {
        Row: {
          created_at: string | null
          current_streak: number | null
          last_action_date: string | null
          longest_streak: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_streak?: number | null
          last_action_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_streak?: number | null
          last_action_date?: string | null
          longest_streak?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wardrobe_items: {
        Row: {
          category: string | null
          color_tags: string[] | null
          created_at: string
          deleted: boolean | null
          id: string
          image_url: string | null
          product_id: string | null
          sub_category: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          color_tags?: string[] | null
          created_at?: string
          deleted?: boolean | null
          id?: string
          image_url?: string | null
          product_id?: string | null
          sub_category?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          color_tags?: string[] | null
          created_at?: string
          deleted?: boolean | null
          id?: string
          image_url?: string | null
          product_id?: string | null
          sub_category?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wardrobe_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wardrobe_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_email_exists: { Args: { lookup_email: string }; Returns: boolean }
      create_order: {
        Args: { _items: Json; _shipping_address: Json }
        Returns: Json
      }
      create_reservation: {
        Args: {
          _appointment_time: string
          _color: string
          _date: string
          _product_id: string
          _quantity: number
          _receipt_path: string
          _size: string
        }
        Returns: Json
      }
      create_reservations_from_cart: {
        Args: {
          _display_id: string
          _items: Json
          _pickup_date: string
          _pickup_time: string
        }
        Returns: undefined
      }
      is_admin_or_owner: { Args: never; Returns: boolean }
      is_staff_or_admin: { Args: never; Returns: boolean }
      update_staff_status: {
        Args: {
          change_note: string
          new_employment_status: string
          new_is_blocked: boolean
          target_staff_id: string
        }
        Returns: undefined
      }
      update_user_streak: { Args: { p_user_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
