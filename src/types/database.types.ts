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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      customer_profiles: {
        Row: {
          active: boolean
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
          created_at: string
          id: string
          sku: string
          stock: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          sku: string
          stock?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          sku?: string
          stock?: number
          updated_at?: string
        }
        Relationships: []
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
      get_customer_catalog: {
        Args: never
        Returns: {
          id: string
          price: number
          sku: string
          stock: number
        }[]
      }
      set_customer_price_group: {
        Args: {
          new_price_group: Database["public"]["Enums"]["customer_price_group"]
          target_customer_id: string
        }
        Returns: Database["public"]["Enums"]["customer_price_group"]
      }
    }
    Enums: {
      customer_price_group: "NORMAL" | "DEALER" | "VIP"
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
    Enums: {
      customer_price_group: ["NORMAL", "DEALER", "VIP"],
      staff_role: ["OWNER", "SALES", "PRODUCT_MANAGER", "SUPPORT", "WAREHOUSE"],
    },
  },
} as const
