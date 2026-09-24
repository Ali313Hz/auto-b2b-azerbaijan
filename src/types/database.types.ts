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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_profiles: {
        Row: {
          active: boolean
          archived_at: string | null
          company_name: string | null
          contact_name: string | null
          created_at: string
          id: string
          phone: string | null
          price_group: Database["public"]["Enums"]["customer_price_group"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          id: string
          phone?: string | null
          price_group?: Database["public"]["Enums"]["customer_price_group"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          phone?: string | null
          price_group?: Database["public"]["Enums"]["customer_price_group"]
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          order_id: string
          product_id: string
          quantity: number
          sku: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total: number
          order_id: string
          product_id: string
          quantity: number
          sku: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          order_id?: string
          product_id?: string
          quantity?: number
          sku?: string
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
          id: string
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_group_audit: {
        Row: {
          changed_at: string
          changed_by: string
          customer_id: string
          id: number
          new_price_group: Database["public"]["Enums"]["customer_price_group"]
          old_price_group: Database["public"]["Enums"]["customer_price_group"]
        }
        Insert: {
          changed_at?: string
          changed_by: string
          customer_id: string
          id?: never
          new_price_group: Database["public"]["Enums"]["customer_price_group"]
          old_price_group: Database["public"]["Enums"]["customer_price_group"]
        }
        Update: {
          changed_at?: string
          changed_by?: string
          customer_id?: string
          id?: never
          new_price_group?: Database["public"]["Enums"]["customer_price_group"]
          old_price_group?: Database["public"]["Enums"]["customer_price_group"]
        }
        Relationships: []
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          media_type: string
          mime_type: string
          original_name: string | null
          product_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          media_type: string
          mime_type: string
          original_name?: string | null
          product_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          media_type?: string
          mime_type?: string
          original_name?: string | null
          product_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_prices: {
        Row: {
          created_at: string
          dealer_price: number
          normal_price: number
          product_id: string
          updated_at: string
          vip_price: number
        }
        Insert: {
          created_at?: string
          dealer_price: number
          normal_price: number
          product_id: string
          updated_at?: string
          vip_price: number
        }
        Update: {
          created_at?: string
          dealer_price?: number
          normal_price?: number
          product_id?: string
          updated_at?: string
          vip_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          sku: string
          stock: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sku: string
          stock?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sku?: string
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name?: string | null
          id: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_to_cart: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: number
      }
      archive_admin_customer: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      change_cart_quantity: {
        Args: { p_delta: number; p_product_id: string }
        Returns: number
      }
      create_admin_category: {
        Args: {
          p_active: boolean
          p_name: string
          p_slug: string
          p_sort_order: number
        }
        Returns: string
      }
      create_admin_product: {
        Args: {
          p_active: boolean
          p_category_id: string
          p_dealer_price: number
          p_normal_price: number
          p_sku: string
          p_stock: number
          p_vip_price: number
        }
        Returns: string
      }
      create_admin_product_media: {
        Args: {
          p_media_type: string
          p_mime_type: string
          p_original_name: string
          p_product_id: string
          p_storage_path: string
        }
        Returns: string
      }
      create_order_from_cart: { Args: never; Returns: string }
      delete_admin_product_media: {
        Args: { p_media_id: string }
        Returns: string
      }
      get_admin_categories: {
        Args: never
        Returns: {
          active: boolean
          id: string
          name: string
          slug: string
          sort_order: number
        }[]
      }
      get_admin_customer_delete_status: {
        Args: { p_customer_id: string }
        Returns: {
          archived: boolean
          can_delete: boolean
          order_count: number
        }[]
      }
      get_admin_customers: {
        Args: never
        Returns: {
          active: boolean
          archived_at: string
          can_permanently_delete: boolean
          company_name: string
          contact_name: string
          created_at: string
          email: string
          id: string
          order_count: number
          phone: string
          price_group: Database["public"]["Enums"]["customer_price_group"]
        }[]
      }
      get_admin_product_media: {
        Args: { p_product_id: string }
        Returns: {
          created_at: string
          id: string
          is_primary: boolean
          media_type: string
          mime_type: string
          original_name: string
          product_id: string
          sort_order: number
          storage_path: string
        }[]
      }
      get_admin_products: {
        Args: never
        Returns: {
          active: boolean
          category_id: string
          category_name: string
          dealer_price: number
          description: string
          id: string
          name: string
          normal_price: number
          sku: string
          stock: number
          vip_price: number
        }[]
      }
      get_customer_cart: {
        Args: never
        Returns: {
          line_total: number
          product_id: string
          quantity: number
          sku: string
          stock: number
          unit_price: number
        }[]
      }
      get_customer_catalog: {
        Args: never
        Returns: {
          category_id: string
          category_name: string
          category_slug: string
          description: string
          id: string
          name: string
          price: number
          primary_image_path: string
          sku: string
          stock: number
        }[]
      }
      get_customer_order_items: {
        Args: { p_order_id: string }
        Returns: {
          line_total: number
          product_id: string
          quantity: number
          sku: string
          unit_price: number
        }[]
      }
      get_customer_orders: {
        Args: never
        Returns: {
          created_at: string
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
        }[]
      }
      get_customer_product_media: {
        Args: { p_product_id: string }
        Returns: {
          id: string
          is_primary: boolean
          media_type: string
          mime_type: string
          original_name: string
          sort_order: number
          storage_path: string
        }[]
      }
      remove_from_cart: { Args: { p_product_id: string }; Returns: undefined }
      restore_admin_customer: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      set_admin_product_primary_media: {
        Args: { p_media_id: string }
        Returns: undefined
      }
      set_customer_active: {
        Args: { new_active: boolean; target_customer_id: string }
        Returns: boolean
      }
      set_customer_price_group: {
        Args: {
          new_price_group: Database["public"]["Enums"]["customer_price_group"]
          target_customer_id: string
        }
        Returns: Database["public"]["Enums"]["customer_price_group"]
      }
      update_admin_category: {
        Args: {
          p_active: boolean
          p_category_id: string
          p_name: string
          p_slug: string
          p_sort_order: number
        }
        Returns: undefined
      }
      update_admin_customer_profile: {
        Args: {
          p_company_name: string
          p_contact_name: string
          p_customer_id: string
          p_phone: string
        }
        Returns: undefined
      }
      update_admin_product: {
        Args: {
          p_dealer_price: number
          p_normal_price: number
          p_product_id: string
          p_stock: number
          p_vip_price: number
        }
        Returns: undefined
      }
      update_admin_product_active: {
        Args: { p_active: boolean; p_product_id: string }
        Returns: undefined
      }
      update_admin_product_content: {
        Args: {
          p_category_id: string
          p_description: string
          p_name: string
          p_product_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      customer_price_group: "NORMAL" | "DEALER" | "VIP"
      order_status: "PENDING" | "CONFIRMED" | "CANCELLED"
      staff_role:
        | "OWNER"
        | "SALES"
        | "PRODUCT_MANAGER"
        | "SUPPORT"
        | "WAREHOUSE"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      customer_price_group: ["NORMAL", "DEALER", "VIP"],
      order_status: ["PENDING", "CONFIRMED", "CANCELLED"],
      staff_role: ["OWNER", "SALES", "PRODUCT_MANAGER", "SUPPORT", "WAREHOUSE"],
    },
  },
} as const
