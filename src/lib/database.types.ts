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
      household_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          household_id: string
          id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          household_id: string
          id?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          household_id?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_invites_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
      }
      household_join_requests: {
        Row: {
          created_at: string
          expires_at: string
          handled_at: string | null
          household_id: string
          id: string
          invite_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          handled_at?: string | null
          household_id: string
          id?: string
          invite_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          handled_at?: string | null
          household_id?: string
          id?: string
          invite_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_join_requests_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_join_requests_invite_id_fkey'
            columns: ['invite_id']
            isOneToOne: false
            referencedRelation: 'household_invites'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_join_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      household_trials: {
        Row: {
          created_at: string
          ends_at: string
          household_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          household_id: string
          starts_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          household_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_trials_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string
          created_at: string
          created_by: string
          household_id: string
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
          household_id: string
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
          household_id?: string
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
            foreignKeyName: 'products_household_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
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
          product_tour_completed_at: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name: string
          product_tour_completed_at?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          product_tour_completed_at?: string | null
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
          household_id: string
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
      approve_household_request: {
        Args: { p_request_id: string }
        Returns: {
          request_id: string
          status: string
        }[]
      }
      complete_product_tour: {
        Args: never
        Returns: {
          product_tour_completed_at: string
        }[]
      }
      create_household_with_trial: {
        Args: never
        Returns: {
          household_id: string
          household_name: string
          trial_ends_at: string
          trial_starts_at: string
        }[]
      }
      create_product: {
        Args: { p_name: string }
        Returns: {
          category: string
          created_at: string
          created_by: string
          household_id: string
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
      current_household_id: { Args: never; Returns: string }
      current_household_invite_request: {
        Args: { p_token: string }
        Returns: {
          expires_at: string
          household_name: string
          status: string
        }[]
      }
      delete_product: {
        Args: { p_expected_version: number; p_product_id: string }
        Returns: boolean
      }
      expire_household_join_requests: {
        Args: { p_household_id: string }
        Returns: undefined
      }
      invite_household_member: {
        Args: never
        Returns: {
          expires_at: string
          invite_token: string
        }[]
      }
      is_household_member: {
        Args: { p_household_id: string }
        Returns: boolean
      }
      list_household_members: {
        Args: { p_household_id: string }
        Returns: {
          created_at: string
          email: string
          name: string
          role: string
          user_id: string
        }[]
      }
      list_pending_household_requests: {
        Args: { p_household_id: string }
        Returns: {
          email: string
          expires_at: string
          name: string
          request_id: string
          requested_at: string
        }[]
      }
      normalize_product_name: { Args: { input: string }; Returns: string }
      preview_household_invite: {
        Args: { p_token: string }
        Returns: {
          approval_required: boolean
          household_name: string
        }[]
      }
      product_name_signature: { Args: { input: string }; Returns: string }
      reject_household_request: {
        Args: { p_request_id: string }
        Returns: {
          request_id: string
          status: string
        }[]
      }
      remove_household_member: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: {
          user_id: string
        }[]
      }
      request_household_access: {
        Args: { p_token: string }
        Returns: {
          expires_at: string
          household_name: string
          request_id: string
          status: string
        }[]
      }
      require_authenticated: { Args: never; Returns: string }
      require_household_membership: { Args: never; Returns: string }
      restore_all_products: {
        Args: { p_clear_notes?: boolean; p_reset_quantities?: boolean }
        Returns: {
          category: string
          created_at: string
          created_by: string
          household_id: string
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
          household_id: string
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
              household_id: string
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
              household_id: string
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
