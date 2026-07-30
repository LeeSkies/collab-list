export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
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
      products: {
        Row: {
          category: string
          created_at: string
          created_by: string
          id: string
          is_picked: boolean
          name: string
          name_signature: string
          notes: string | null
          ordering_at: string
          picked_at: string | null
          quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          is_picked?: boolean
          name: string
          name_signature: string
          notes?: string | null
          ordering_at?: string
          picked_at?: string | null
          quantity?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          is_picked?: boolean
          name?: string
          name_signature?: string
          notes?: string | null
          ordering_at?: string
          picked_at?: string | null
          quantity?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'products_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'products_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_product_quantity: {
        Args: {
          p_delta: number
          p_expected_version: number
          p_product_id: string
        }
        Returns: {
          category: string
          created_at: string
          created_by: string
          id: string
          is_picked: boolean
          name: string
          name_signature: string
          notes: string | null
          ordering_at: string
          picked_at: string | null
          quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }[]
        SetofOptions: {
          from: '*'
          to: 'products'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_product: {
        Args: { p_name: string }
        Returns: {
          category: string
          created_at: string
          created_by: string
          id: string
          is_picked: boolean
          name: string
          name_signature: string
          notes: string | null
          ordering_at: string
          picked_at: string | null
          quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }[]
        SetofOptions: {
          from: '*'
          to: 'products'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_product: {
        Args: { p_expected_version: number; p_product_id: string }
        Returns: boolean
      }
      normalize_product_name: { Args: { input: string }; Returns: string }
      product_name_signature: { Args: { input: string }; Returns: string }
      require_authenticated: { Args: never; Returns: string }
      restore_all_products: {
        Args: { p_clear_notes?: boolean; p_reset_quantities?: boolean }
        Returns: {
          category: string
          created_at: string
          created_by: string
          id: string
          is_picked: boolean
          name: string
          name_signature: string
          notes: string | null
          ordering_at: string
          picked_at: string | null
          quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }[]
        SetofOptions: {
          from: '*'
          to: 'products'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      toggle_product_picked: {
        Args: {
          p_expected_picked: boolean
          p_expected_version: number
          p_product_id: string
        }
        Returns: {
          category: string
          created_at: string
          created_by: string
          id: string
          is_picked: boolean
          name: string
          name_signature: string
          notes: string | null
          ordering_at: string
          picked_at: string | null
          quantity: number
          updated_at: string
          updated_by: string | null
          version: number
        }[]
        SetofOptions: {
          from: '*'
          to: 'products'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_product:
        | {
            Args: {
              p_category: string
              p_expected_version: number
              p_name: string
              p_notes: string
              p_product_id: string
              p_quantity: string
            }
            Returns: {
              category: string
              created_at: string
              created_by: string
              id: string
              is_picked: boolean
              name: string
              name_signature: string
              notes: string | null
              ordering_at: string
              picked_at: string | null
              quantity: number
              updated_at: string
              updated_by: string | null
              version: number
            }[]
            SetofOptions: {
              from: '*'
              to: 'products'
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_expected_version: number
              p_name: string
              p_notes: string
              p_product_id: string
              p_quantity: string
            }
            Returns: {
              category: string
              created_at: string
              created_by: string
              id: string
              is_picked: boolean
              name: string
              name_signature: string
              notes: string | null
              ordering_at: string
              picked_at: string | null
              quantity: number
              updated_at: string
              updated_by: string | null
              version: number
            }[]
            SetofOptions: {
              from: '*'
              to: 'products'
              isOneToOne: false
              isSetofReturn: true
            }
          }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {}
  },
  public: {
    Enums: {}
  }
} as const
