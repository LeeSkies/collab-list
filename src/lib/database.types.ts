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
      account_trial_eligibility: {
        Row: {
          created_at: string
          eligibility_consumed_at: string | null
          exposure_days: number
          owned_household_id: string | null
          owned_trial_started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          eligibility_consumed_at?: string | null
          exposure_days?: number
          owned_household_id?: string | null
          owned_trial_started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          eligibility_consumed_at?: string | null
          exposure_days?: number
          owned_household_id?: string | null
          owned_trial_started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'account_trial_eligibility_owned_household_id_fkey'
            columns: ['owned_household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_trial_eligibility_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      categories: {
        Row: {
          household_id: string
          id: string
          name: string
        }
        Insert: {
          household_id: string
          id?: string
          name: string
        }
        Update: {
          household_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'categories_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
      }
      deleted_households: {
        Row: {
          deleted_at: string
          former_admin_id: string
          household_id: string
          household_name: string
          purge_at: string
        }
        Insert: {
          deleted_at?: string
          former_admin_id: string
          household_id: string
          household_name: string
          purge_at: string
        }
        Update: {
          deleted_at?: string
          former_admin_id?: string
          household_id?: string
          household_name?: string
          purge_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deleted_households_former_admin_id_fkey'
            columns: ['former_admin_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deleted_households_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      household_billing_actions: {
        Row: {
          action: string
          created_at: string
          detail: Json
          household_id: string
          id: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          household_id: string
          id?: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          household_id?: string
          id?: string
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_billing_actions_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_billing_actions_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      household_cancellation_outbox: {
        Row: {
          created_at: string
          household_id: string
          id: string
          provider: string | null
          provider_subscription_id: string | null
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          provider?: string | null
          provider_subscription_id?: string | null
          reason: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          provider?: string | null
          provider_subscription_id?: string | null
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      household_entitlements: {
        Row: {
          created_at: string
          entitlement_plan: string
          household_id: string
          seat_limit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          entitlement_plan?: string
          household_id: string
          seat_limit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entitlement_plan?: string
          household_id?: string
          seat_limit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_entitlements_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
      }
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
      household_member_intervals: {
        Row: {
          created_at: string
          ended_at: string | null
          household_id: string
          id: number
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          household_id: string
          id?: never
          started_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          household_id?: string
          id?: never
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_member_intervals_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'household_member_intervals_user_id_fkey'
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
      household_subscriptions: {
        Row: {
          add_on_seat_count: number
          add_on_unit_amount_minor_units: number | null
          base_seat_allowance: number
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string | null
          current_period_end: string
          current_period_start: string
          household_id: string
          provider: string
          provider_event_at: string
          provider_event_id: string
          provider_subscription_id: string
          status: string
          updated_at: string
        }
        Insert: {
          add_on_seat_count?: number
          add_on_unit_amount_minor_units?: number | null
          base_seat_allowance?: number
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end: string
          current_period_start: string
          household_id: string
          provider: string
          provider_event_at?: string
          provider_event_id: string
          provider_subscription_id: string
          status: string
          updated_at?: string
        }
        Update: {
          add_on_seat_count?: number
          add_on_unit_amount_minor_units?: number | null
          base_seat_allowance?: number
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string
          current_period_start?: string
          household_id?: string
          provider?: string
          provider_event_at?: string
          provider_event_id?: string
          provider_subscription_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_subscriptions_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
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
          deleted_at: string | null
          deletion_expires_at: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deletion_expires_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deletion_expires_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category_id: string
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
          category_id: string
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
          category_id?: string
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
            foreignKeyName: 'products_household_category_fkey'
            columns: ['household_id', 'category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['household_id', 'id']
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
      subscription_provider_events: {
        Row: {
          applied_at: string
          household_id: string
          id: number
          provider: string
          provider_event_at: string
          provider_event_id: string
          provider_subscription_id: string | null
        }
        Insert: {
          applied_at?: string
          household_id: string
          id?: never
          provider: string
          provider_event_at?: string
          provider_event_id: string
          provider_subscription_id?: string | null
        }
        Update: {
          applied_at?: string
          household_id?: string
          id?: never
          provider?: string
          provider_event_at?: string
          provider_event_id?: string
          provider_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'subscription_provider_events_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          }
        ]
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
          category_id: string
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
      admin_request_billing_action: {
        Args: { p_action: string }
        Returns: {
          action: string
          action_id: string
          created_at: string
          status: string
        }[]
      }
      approve_household_request: {
        Args: { p_confirm_add_on_charge?: boolean; p_request_id: string }
        Returns: {
          request_id: string
          status: string
        }[]
      }
      claim_owned_household_trial: {
        Args: { p_household_id: string; p_starts_at: string }
        Returns: undefined
      }
      complete_product_tour: {
        Args: never
        Returns: {
          product_tour_completed_at: string
        }[]
      }
      create_category: {
        Args: { p_name: string }
        Returns: {
          household_id: string
          id: string
          name: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'categories'
          isOneToOne: false
          isSetofReturn: true
        }
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
          category_id: string
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
      current_deleted_household: {
        Args: never
        Returns: {
          deleted_at: string
          household_id: string
          household_name: string
          purge_at: string
          recoverable: boolean
        }[]
      }
      current_household_entitlement: {
        Args: never
        Returns: {
          access_state: string
          can_mutate: boolean
          enforcement_enabled: boolean
          grace_ends_at: string
          household_id: string
          reads_available: boolean
          seat_limit: number
          trial_ends_at: string
          trial_starts_at: string
        }[]
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
      current_household_subscription: {
        Args: never
        Returns: {
          active_member_count: number
          add_on_seat_count: number
          add_on_unit_amount_minor_units: number
          base_seat_allowance: number
          billed_seat_count: number
          billing_enabled: boolean
          cancel_at_period_end: boolean
          canceled_at: string
          currency: string
          current_period_end: string
          current_period_start: string
          grace_ends_at: string
          household_id: string
          provider: string
          provider_event_id: string
          provider_subscription_id: string
          status: string
        }[]
      }
      delete_category: { Args: { p_category_id: string }; Returns: boolean }
      delete_household: { Args: { p_purge_now?: boolean }; Returns: boolean }
      delete_product: {
        Args: { p_expected_version: number; p_product_id: string }
        Returns: boolean
      }
      entitlement_enforcement_enabled: { Args: never; Returns: boolean }
      expire_household_join_requests: {
        Args: { p_household_id: string }
        Returns: undefined
      }
      household_effective_seat_limit: {
        Args: { p_household_id: string }
        Returns: number
      }
      household_entitlement_for: {
        Args: { p_household_id: string }
        Returns: {
          access_state: string
          can_mutate: boolean
          enforcement_enabled: boolean
          grace_ends_at: string
          household_id: string
          reads_available: boolean
          seat_limit: number
          trial_ends_at: string
          trial_starts_at: string
        }[]
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
      purge_expired_deleted_households: { Args: never; Returns: number }
      recover_deleted_household: { Args: never; Returns: boolean }
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
      require_household_entitlement_state: {
        Args: { p_household_id: string }
        Returns: string
      }
      require_household_membership: { Args: never; Returns: string }
      require_household_mutation_access: {
        Args: { p_household_id: string }
        Returns: string
      }
      reset_household: {
        Args: { p_clear_products: boolean; p_remove_members: boolean }
        Returns: {
          members_removed: number
          products_deleted: number
        }[]
      }
      restore_all_products: {
        Args: { p_clear_notes?: boolean; p_reset_quantities?: boolean }
        Returns: {
          category_id: string
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
      sync_account_trial_eligibility: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      sync_subscription_from_provider: {
        Args: {
          p_add_on_seat_count?: number
          p_add_on_unit_amount_minor_units?: number
          p_base_seat_allowance?: number
          p_cancel_at_period_end?: boolean
          p_canceled_at?: string
          p_currency?: string
          p_current_period_end: string
          p_current_period_start: string
          p_household_id: string
          p_provider: string
          p_provider_event_at: string
          p_provider_event_id?: string
          p_provider_subscription_id: string
          p_status: string
        }
        Returns: undefined
      }
      toggle_product_picked: {
        Args: {
          p_expected_picked: boolean
          p_expected_version: number
          p_product_id: string
        }
        Returns: {
          category_id: string
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
      update_product: {
        Args: {
          p_category_id: string
          p_expected_version: number
          p_name: string
          p_notes: string
          p_product_id: string
          p_quantity: string
        }
        Returns: {
          category_id: string
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
