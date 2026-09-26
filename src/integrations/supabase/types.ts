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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      _internal_secrets: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      account_modifications: {
        Row: {
          account_id: string | null
          account_table: string
          client_id: string | null
          created_at: string
          id: string
          modification_source: string
          modification_type: string
          modified_by_user_id: string
          new_value: Json | null
          notes: string | null
          previous_value: Json | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_table?: string
          client_id?: string | null
          created_at?: string
          id?: string
          modification_source: string
          modification_type: string
          modified_by_user_id: string
          new_value?: Json | null
          notes?: string | null
          previous_value?: Json | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_table?: string
          client_id?: string | null
          created_at?: string
          id?: string
          modification_source?: string
          modification_type?: string
          modified_by_user_id?: string
          new_value?: Json | null
          notes?: string | null
          previous_value?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_modifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_modifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "account_modifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "account_modifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      affiliate_applications: {
        Row: {
          audience_description: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          requested_tier_key: string
          resulting_affiliate_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          social_links: string | null
          status: string
          updated_at: string
          user_id: string | null
          website_url: string | null
          why_join: string | null
        }
        Insert: {
          audience_description?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
          requested_tier_key?: string
          resulting_affiliate_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          social_links?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          website_url?: string | null
          why_join?: string | null
        }
        Update: {
          audience_description?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          requested_tier_key?: string
          resulting_affiliate_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          social_links?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          website_url?: string | null
          why_join?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_applications_resulting_affiliate_id_fkey"
            columns: ["resulting_affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_applications_resulting_affiliate_id_fkey"
            columns: ["resulting_affiliate_id"]
            isOneToOne: false
            referencedRelation: "v_affiliate_stats"
            referencedColumns: ["affiliate_id"]
          },
        ]
      }
      affiliate_commission_tiers: {
        Row: {
          commission_rate: number
          created_at: string
          display_name: string
          duration_months: number | null
          id: string
          is_recurring: boolean
          notes: string | null
          tier_key: string
          updated_at: string
        }
        Insert: {
          commission_rate: number
          created_at?: string
          display_name: string
          duration_months?: number | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          tier_key: string
          updated_at?: string
        }
        Update: {
          commission_rate?: number
          created_at?: string
          display_name?: string
          duration_months?: number | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          tier_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_profiles: {
        Row: {
          active: boolean
          commission_tier_id: string | null
          created_at: string
          enrolled_from: string | null
          id: string
          referral_code: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          commission_tier_id?: string | null
          created_at?: string
          enrolled_from?: string | null
          id?: string
          referral_code: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          commission_tier_id?: string | null
          created_at?: string
          enrolled_from?: string | null
          id?: string
          referral_code?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_profiles_commission_tier_id_fkey"
            columns: ["commission_tier_id"]
            isOneToOne: false
            referencedRelation: "affiliate_commission_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_team_members: {
        Row: {
          agency_role: string
          agency_tenant_id: string
          created_at: string
          email: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string | null
          scoped_subaccounts: string[]
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agency_role: string
          agency_tenant_id: string
          created_at?: string
          email?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          scoped_subaccounts?: string[]
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agency_role?: string
          agency_tenant_id?: string
          created_at?: string
          email?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          scoped_subaccounts?: string[]
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_team_members_agency_tenant_id_fkey"
            columns: ["agency_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          body_markdown: string
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_forkable: boolean
          layer: string
          merge_fields: Json
          required_at_signup: boolean
          slug: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body_markdown: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_forkable?: boolean
          layer: string
          merge_fields?: Json
          required_at_signup?: boolean
          slug: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_markdown?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_forkable?: boolean
          layer?: string
          merge_fields?: Json
          required_at_signup?: boolean
          slug?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          device_type: string | null
          event_category: string
          event_name: string
          id: string
          page_path: string | null
          properties: Json
          referral_code: string | null
          referrer: string | null
          session_id: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          device_type?: string | null
          event_category: string
          event_name: string
          id?: string
          page_path?: string | null
          properties?: Json
          referral_code?: string | null
          referrer?: string | null
          session_id?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          device_type?: string | null
          event_category?: string
          event_name?: string
          id?: string
          page_path?: string | null
          properties?: Json
          referral_code?: string | null
          referrer?: string | null
          session_id?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          created_at: string
          function_name: string
          id: string
          request_count: number
          user_id: string | null
          window_start: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          request_count?: number
          user_id?: string | null
          window_start?: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          request_count?: number
          user_id?: string | null
          window_start?: string
        }
        Relationships: []
      }
      app_settings_owner: {
        Row: {
          owner_email: string
        }
        Insert: {
          owner_email: string
        }
        Update: {
          owner_email?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          data: Json | null
          entity: string
          entity_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          data?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          data?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      balance_snapshots: {
        Row: {
          account_id: string
          available: number | null
          balance: number
          created_at: string | null
          id: string
          snapshot_date: string
          user_id: string
        }
        Insert: {
          account_id: string
          available?: number | null
          balance: number
          created_at?: string | null
          id?: string
          snapshot_date: string
          user_id: string
        }
        Update: {
          account_id?: string
          available?: number | null
          balance?: number
          created_at?: string | null
          id?: string
          snapshot_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      banking_relationships: {
        Row: {
          account_open_date: string | null
          account_standing: string
          average_monthly_balance: number | null
          business_id: string | null
          created_at: string
          current_balance: number | null
          has_direct_deposit: boolean
          id: string
          institution_name: string
          institution_type: string
          is_primary_institution: boolean
          months_at_institution: number | null
          nsf_count_last_12_months: number
          overdraft_count_last_12_months: number
          qb_account_id: string | null
          qb_synced_at: string | null
          relationship_type: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_open_date?: string | null
          account_standing?: string
          average_monthly_balance?: number | null
          business_id?: string | null
          created_at?: string
          current_balance?: number | null
          has_direct_deposit?: boolean
          id?: string
          institution_name: string
          institution_type: string
          is_primary_institution?: boolean
          months_at_institution?: number | null
          nsf_count_last_12_months?: number
          overdraft_count_last_12_months?: number
          qb_account_id?: string | null
          qb_synced_at?: string | null
          relationship_type: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_open_date?: string | null
          account_standing?: string
          average_monthly_balance?: number | null
          business_id?: string | null
          created_at?: string
          current_balance?: number | null
          has_direct_deposit?: boolean
          id?: string
          institution_name?: string
          institution_type?: string
          is_primary_institution?: boolean
          months_at_institution?: number | null
          nsf_count_last_12_months?: number
          overdraft_count_last_12_months?: number
          qb_account_id?: string | null
          qb_synced_at?: string | null
          relationship_type?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "banking_relationships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notifications_sent: {
        Row: {
          booking_id: string
          id: string
          notif_key: string
          recipient_email: string | null
          sent_at: string
          status: string
        }
        Insert: {
          booking_id: string
          id?: string
          notif_key: string
          recipient_email?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          booking_id?: string
          id?: string
          notif_key?: string
          recipient_email?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notifications_sent_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "internal_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_client_relationships: {
        Row: {
          added_at: string
          broker_id: string
          broker_notes: string | null
          client_email: string
          client_first_name: string
          client_goal: string | null
          client_last_name: string
          client_phone: string | null
          client_stripe_subscription_id: string | null
          client_subscription_status: string
          client_user_id: string | null
          created_at: string
          discount_code: string | null
          id: string
          is_active: boolean
          last_session_at: string | null
          last_session_summary: string | null
          notes: string | null
          relationship_stage: string | null
          session_count: number
          shared_goal: string | null
          updated_at: string
        }
        Insert: {
          added_at?: string
          broker_id: string
          broker_notes?: string | null
          client_email: string
          client_first_name: string
          client_goal?: string | null
          client_last_name: string
          client_phone?: string | null
          client_stripe_subscription_id?: string | null
          client_subscription_status?: string
          client_user_id?: string | null
          created_at?: string
          discount_code?: string | null
          id?: string
          is_active?: boolean
          last_session_at?: string | null
          last_session_summary?: string | null
          notes?: string | null
          relationship_stage?: string | null
          session_count?: number
          shared_goal?: string | null
          updated_at?: string
        }
        Update: {
          added_at?: string
          broker_id?: string
          broker_notes?: string | null
          client_email?: string
          client_first_name?: string
          client_goal?: string | null
          client_last_name?: string
          client_phone?: string | null
          client_stripe_subscription_id?: string | null
          client_subscription_status?: string
          client_user_id?: string | null
          created_at?: string
          discount_code?: string | null
          id?: string
          is_active?: boolean
          last_session_at?: string | null
          last_session_summary?: string | null
          notes?: string | null
          relationship_stage?: string | null
          session_count?: number
          shared_goal?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_client_relationships_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "broker_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_paige_sessions: {
        Row: {
          broker_id: string
          client_relationship_id: string
          conversation: Json
          created_at: string
          id: string
          key_insights: Json | null
          session_type: string
          summary: string | null
          summary_shared_at: string | null
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          broker_id: string
          client_relationship_id: string
          conversation?: Json
          created_at?: string
          id?: string
          key_insights?: Json | null
          session_type?: string
          summary?: string | null
          summary_shared_at?: string | null
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          broker_id?: string
          client_relationship_id?: string
          conversation?: Json
          created_at?: string
          id?: string
          key_insights?: Json | null
          session_type?: string
          summary?: string | null
          summary_shared_at?: string | null
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_paige_sessions_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "broker_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_paige_sessions_client_relationship_id_fkey"
            columns: ["client_relationship_id"]
            isOneToOne: false
            referencedRelation: "broker_client_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_paige_sessions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "broker_team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_profiles: {
        Row: {
          approved_at: string | null
          bio: string | null
          broker_client_discount_code: string | null
          broker_referral_code: string | null
          broker_type: string
          business_name: string
          client_count: number
          client_count_quoted: number | null
          created_at: string
          current_client_count: number
          decline_reason: string | null
          declined_at: string | null
          firm_description: string | null
          id: string
          license_number: string | null
          monthly_fee: number
          paige_context_notes: string | null
          preferred_greeting: string | null
          referral_code: string | null
          specializations: string[] | null
          status: string
          stripe_customer_id_ct: string | null
          stripe_subscription_id_ct: string | null
          subscription_status: string
          typical_client_profile: string | null
          updated_at: string
          use_case: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          approved_at?: string | null
          bio?: string | null
          broker_client_discount_code?: string | null
          broker_referral_code?: string | null
          broker_type: string
          business_name: string
          client_count?: number
          client_count_quoted?: number | null
          created_at?: string
          current_client_count?: number
          decline_reason?: string | null
          declined_at?: string | null
          firm_description?: string | null
          id?: string
          license_number?: string | null
          monthly_fee?: number
          paige_context_notes?: string | null
          preferred_greeting?: string | null
          referral_code?: string | null
          specializations?: string[] | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          subscription_status?: string
          typical_client_profile?: string | null
          updated_at?: string
          use_case?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          approved_at?: string | null
          bio?: string | null
          broker_client_discount_code?: string | null
          broker_referral_code?: string | null
          broker_type?: string
          business_name?: string
          client_count?: number
          client_count_quoted?: number | null
          created_at?: string
          current_client_count?: number
          decline_reason?: string | null
          declined_at?: string | null
          firm_description?: string | null
          id?: string
          license_number?: string | null
          monthly_fee?: number
          paige_context_notes?: string | null
          preferred_greeting?: string | null
          referral_code?: string | null
          specializations?: string[] | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          subscription_status?: string
          typical_client_profile?: string | null
          updated_at?: string
          use_case?: string | null
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      broker_referral_commissions: {
        Row: {
          commission_rate: number
          created_at: string
          duration_months: number
          expires_at: string | null
          id: string
          monthly_amount: number
          referred_broker_id: string
          referring_broker_id: string
          started_at: string
          status: string
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          duration_months?: number
          expires_at?: string | null
          id?: string
          monthly_amount: number
          referred_broker_id: string
          referring_broker_id: string
          started_at?: string
          status?: string
        }
        Update: {
          commission_rate?: number
          created_at?: string
          duration_months?: number
          expires_at?: string | null
          id?: string
          monthly_amount?: number
          referred_broker_id?: string
          referring_broker_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_referral_commissions_referred_broker_id_fkey"
            columns: ["referred_broker_id"]
            isOneToOne: false
            referencedRelation: "broker_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_referral_commissions_referring_broker_id_fkey"
            columns: ["referring_broker_id"]
            isOneToOne: false
            referencedRelation: "broker_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_session_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_session_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "broker_paige_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_team_members: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          broker_id: string
          created_at: string
          email: string
          first_name: string | null
          id: string
          invitation_expires_at: string | null
          invitation_token: string | null
          invited_at: string
          last_name: string | null
          last_sign_in_at: string | null
          permissions: Json
          role: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          broker_id: string
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string
          last_name?: string | null
          last_sign_in_at?: string | null
          permissions?: Json
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          broker_id?: string
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string
          last_name?: string | null
          last_sign_in_at?: string | null
          permissions?: Json
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broker_team_members_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "broker_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_use_sessions: {
        Row: {
          completed_at: string | null
          cost_cents: number
          created_at: string
          duration_ms: number | null
          error: string | null
          goal: string
          id: string
          invoker_kind: string
          invoker_user_id: string | null
          related_business_id: string | null
          related_contact_id: string | null
          result: Json
          screenshots: string[]
          session_replay_url: string | null
          start_url: string | null
          status: string
          steps: Json
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          goal: string
          id?: string
          invoker_kind?: string
          invoker_user_id?: string | null
          related_business_id?: string | null
          related_contact_id?: string | null
          result?: Json
          screenshots?: string[]
          session_replay_url?: string | null
          start_url?: string | null
          status?: string
          steps?: Json
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          goal?: string
          id?: string
          invoker_kind?: string
          invoker_user_id?: string | null
          related_business_id?: string | null
          related_contact_id?: string | null
          result?: Json
          screenshots?: string[]
          session_replay_url?: string | null
          start_url?: string | null
          status?: string
          steps?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_use_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_use_sessions_related_business_id_fkey"
            columns: ["related_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_use_sessions_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_use_sessions_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "browser_use_sessions_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "browser_use_sessions_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      build_milestones: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          id: string
          milestone_key: string
          phase: string
          required_for_phase: boolean
          sort_order: number
          track: string
          verification_type: string
          weight: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          milestone_key: string
          phase: string
          required_for_phase?: boolean
          sort_order?: number
          track: string
          verification_type: string
          weight?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          milestone_key?: string
          phase?: string
          required_for_phase?: boolean
          sort_order?: number
          track?: string
          verification_type?: string
          weight?: number
        }
        Relationships: []
      }
      build_progress: {
        Row: {
          business_id: string | null
          created_at: string
          current_phase: string
          id: string
          last_assessed_at: string
          overall_score: number
          phase_started_at: string
          phase_target_completion: string | null
          track: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          current_phase?: string
          id?: string
          last_assessed_at?: string
          overall_score?: number
          phase_started_at?: string
          phase_target_completion?: string | null
          track: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          current_phase?: string
          id?: string
          last_assessed_at?: string
          overall_score?: number
          phase_started_at?: string
          phase_target_completion?: string | null
          track?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_progress_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      build_recommendations: {
        Row: {
          acted_at: string | null
          action_type: string
          body: string
          created_at: string
          external_url: string | null
          id: string
          milestone_key: string | null
          phase: string
          priority: number
          status: string
          title: string
          track: string
          user_id: string
          vendor_or_product: string | null
        }
        Insert: {
          acted_at?: string | null
          action_type: string
          body: string
          created_at?: string
          external_url?: string | null
          id?: string
          milestone_key?: string | null
          phase: string
          priority?: number
          status?: string
          title: string
          track: string
          user_id: string
          vendor_or_product?: string | null
        }
        Update: {
          acted_at?: string | null
          action_type?: string
          body?: string
          created_at?: string
          external_url?: string | null
          id?: string
          milestone_key?: string | null
          phase?: string
          priority?: number
          status?: string
          title?: string
          track?: string
          user_id?: string
          vendor_or_product?: string | null
        }
        Relationships: []
      }
      build_scores: {
        Row: {
          active_vendors: number | null
          activity_recency_score: number | null
          build_score: number | null
          bureau_health_score: number | null
          compliance_pass: boolean | null
          compliance_score: number | null
          created_at: string | null
          current_tier: string | null
          duns_verified: boolean | null
          funding_readiness_score: number | null
          id: string
          intelliscore: number | null
          last_calculated_at: string | null
          months_clean_reporting: number | null
          paydex: number | null
          tier_b_unlocked: boolean | null
          tier_d_unlocked: boolean | null
          tier_i_unlocked: boolean | null
          tier_l_unlocked: boolean | null
          tier_u_unlocked: boolean | null
          updated_at: string | null
          user_id: string
          vendors_score: number | null
        }
        Insert: {
          active_vendors?: number | null
          activity_recency_score?: number | null
          build_score?: number | null
          bureau_health_score?: number | null
          compliance_pass?: boolean | null
          compliance_score?: number | null
          created_at?: string | null
          current_tier?: string | null
          duns_verified?: boolean | null
          funding_readiness_score?: number | null
          id?: string
          intelliscore?: number | null
          last_calculated_at?: string | null
          months_clean_reporting?: number | null
          paydex?: number | null
          tier_b_unlocked?: boolean | null
          tier_d_unlocked?: boolean | null
          tier_i_unlocked?: boolean | null
          tier_l_unlocked?: boolean | null
          tier_u_unlocked?: boolean | null
          updated_at?: string | null
          user_id: string
          vendors_score?: number | null
        }
        Update: {
          active_vendors?: number | null
          activity_recency_score?: number | null
          build_score?: number | null
          bureau_health_score?: number | null
          compliance_pass?: boolean | null
          compliance_score?: number | null
          created_at?: string | null
          current_tier?: string | null
          duns_verified?: boolean | null
          funding_readiness_score?: number | null
          id?: string
          intelliscore?: number | null
          last_calculated_at?: string | null
          months_clean_reporting?: number | null
          paydex?: number | null
          tier_b_unlocked?: boolean | null
          tier_d_unlocked?: boolean | null
          tier_i_unlocked?: boolean | null
          tier_l_unlocked?: boolean | null
          tier_u_unlocked?: boolean | null
          updated_at?: string | null
          user_id?: string
          vendors_score?: number | null
        }
        Relationships: []
      }
      business_certifications: {
        Row: {
          applied_at: string | null
          business_id: string
          certification_number: string | null
          certification_type: string
          certified_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          business_id: string
          certification_number?: string | null
          certification_type: string
          certified_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          business_id?: string
          certification_number?: string | null
          certification_type?: string
          certified_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_certifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_credit_history: {
        Row: {
          bureau: string
          business_id: string
          created_at: string
          id: string
          metric_name: string
          recorded_at: string
          score_value: number
          user_id: string
        }
        Insert: {
          bureau: string
          business_id: string
          created_at?: string
          id?: string
          metric_name: string
          recorded_at?: string
          score_value: number
          user_id: string
        }
        Update: {
          bureau?: string
          business_id?: string
          created_at?: string
          id?: string
          metric_name?: string
          recorded_at?: string
          score_value?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_credit_history_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_credit_reports: {
        Row: {
          bureau: string
          business_id: string | null
          created_at: string
          days_beyond_terms: number | null
          derogatory_count: number | null
          extraction_error: string | null
          extraction_status: string
          file_path: string | null
          file_url: string | null
          highest_credit_extended: number | null
          id: string
          intelliscore: number | null
          paydex_score: number | null
          payment_trend: string | null
          raw_text: string | null
          report_date: string | null
          sbfe_score: number | null
          trade_line_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bureau: string
          business_id?: string | null
          created_at?: string
          days_beyond_terms?: number | null
          derogatory_count?: number | null
          extraction_error?: string | null
          extraction_status?: string
          file_path?: string | null
          file_url?: string | null
          highest_credit_extended?: number | null
          id?: string
          intelliscore?: number | null
          paydex_score?: number | null
          payment_trend?: string | null
          raw_text?: string | null
          report_date?: string | null
          sbfe_score?: number | null
          trade_line_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bureau?: string
          business_id?: string | null
          created_at?: string
          days_beyond_terms?: number | null
          derogatory_count?: number | null
          extraction_error?: string | null
          extraction_status?: string
          file_path?: string | null
          file_url?: string | null
          highest_credit_extended?: number | null
          id?: string
          intelliscore?: number | null
          paydex_score?: number | null
          payment_trend?: string | null
          raw_text?: string | null
          report_date?: string | null
          sbfe_score?: number | null
          trade_line_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_credit_reports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_financial_docs: {
        Row: {
          business_id: string
          created_at: string | null
          doc_type: string
          document_id: string | null
          expiry_date: string | null
          id: string
          notes: string | null
          status: string
          updated_at: string | null
          upload_date: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          doc_type: string
          document_id?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          upload_date?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          doc_type?: string
          document_id?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          upload_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_financial_docs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_financial_docs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      business_public_presence: {
        Row: {
          business_id: string
          created_at: string | null
          facebook_address_match: boolean | null
          facebook_name_match: boolean | null
          facebook_phone_match: boolean | null
          facebook_url: string | null
          google_address_match: boolean | null
          google_business_claimed: boolean | null
          google_business_url: string | null
          google_name_match: boolean | null
          google_phone_match: boolean | null
          id: string
          linkedin_address_match: boolean | null
          linkedin_name_match: boolean | null
          linkedin_phone_match: boolean | null
          linkedin_url: string | null
          listyourself_address_match: boolean | null
          listyourself_name_match: boolean | null
          listyourself_phone_match: boolean | null
          listyourself_url: string | null
          official_address: string | null
          official_name: string | null
          official_phone: string | null
          other_listings: string | null
          other1_address_match: boolean | null
          other1_label: string | null
          other1_name_match: boolean | null
          other1_phone_match: boolean | null
          other1_url: string | null
          other2_address_match: boolean | null
          other2_label: string | null
          other2_name_match: boolean | null
          other2_phone_match: boolean | null
          other2_url: string | null
          updated_at: string | null
          user_id: string
          website_address_match: boolean | null
          website_live: boolean | null
          website_name_match: boolean | null
          website_phone_match: boolean | null
          website_url: string | null
          yelp_address_match: boolean | null
          yelp_exists: boolean | null
          yelp_name_match: boolean | null
          yelp_phone_match: boolean | null
          yelp_url: string | null
        }
        Insert: {
          business_id: string
          created_at?: string | null
          facebook_address_match?: boolean | null
          facebook_name_match?: boolean | null
          facebook_phone_match?: boolean | null
          facebook_url?: string | null
          google_address_match?: boolean | null
          google_business_claimed?: boolean | null
          google_business_url?: string | null
          google_name_match?: boolean | null
          google_phone_match?: boolean | null
          id?: string
          linkedin_address_match?: boolean | null
          linkedin_name_match?: boolean | null
          linkedin_phone_match?: boolean | null
          linkedin_url?: string | null
          listyourself_address_match?: boolean | null
          listyourself_name_match?: boolean | null
          listyourself_phone_match?: boolean | null
          listyourself_url?: string | null
          official_address?: string | null
          official_name?: string | null
          official_phone?: string | null
          other_listings?: string | null
          other1_address_match?: boolean | null
          other1_label?: string | null
          other1_name_match?: boolean | null
          other1_phone_match?: boolean | null
          other1_url?: string | null
          other2_address_match?: boolean | null
          other2_label?: string | null
          other2_name_match?: boolean | null
          other2_phone_match?: boolean | null
          other2_url?: string | null
          updated_at?: string | null
          user_id: string
          website_address_match?: boolean | null
          website_live?: boolean | null
          website_name_match?: boolean | null
          website_phone_match?: boolean | null
          website_url?: string | null
          yelp_address_match?: boolean | null
          yelp_exists?: boolean | null
          yelp_name_match?: boolean | null
          yelp_phone_match?: boolean | null
          yelp_url?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string | null
          facebook_address_match?: boolean | null
          facebook_name_match?: boolean | null
          facebook_phone_match?: boolean | null
          facebook_url?: string | null
          google_address_match?: boolean | null
          google_business_claimed?: boolean | null
          google_business_url?: string | null
          google_name_match?: boolean | null
          google_phone_match?: boolean | null
          id?: string
          linkedin_address_match?: boolean | null
          linkedin_name_match?: boolean | null
          linkedin_phone_match?: boolean | null
          linkedin_url?: string | null
          listyourself_address_match?: boolean | null
          listyourself_name_match?: boolean | null
          listyourself_phone_match?: boolean | null
          listyourself_url?: string | null
          official_address?: string | null
          official_name?: string | null
          official_phone?: string | null
          other_listings?: string | null
          other1_address_match?: boolean | null
          other1_label?: string | null
          other1_name_match?: boolean | null
          other1_phone_match?: boolean | null
          other1_url?: string | null
          other2_address_match?: boolean | null
          other2_label?: string | null
          other2_name_match?: boolean | null
          other2_phone_match?: boolean | null
          other2_url?: string | null
          updated_at?: string | null
          user_id?: string
          website_address_match?: boolean | null
          website_live?: boolean | null
          website_name_match?: boolean | null
          website_phone_match?: boolean | null
          website_url?: string | null
          yelp_address_match?: boolean | null
          yelp_exists?: boolean | null
          yelp_name_match?: boolean | null
          yelp_phone_match?: boolean | null
          yelp_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_public_presence_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_vendors: {
        Row: {
          account_number: string | null
          account_opened_date: string | null
          business_id: string | null
          created_at: string | null
          credit_limit: number | null
          early_payments: number | null
          id: string
          is_active: boolean | null
          last_payment_date: string | null
          late_payments: number | null
          on_time_payments: number | null
          payment_terms: string | null
          reports_to_bureaus: boolean | null
          total_payments: number | null
          updated_at: string | null
          user_id: string
          vendor_name: string
          vendor_type: string
        }
        Insert: {
          account_number?: string | null
          account_opened_date?: string | null
          business_id?: string | null
          created_at?: string | null
          credit_limit?: number | null
          early_payments?: number | null
          id?: string
          is_active?: boolean | null
          last_payment_date?: string | null
          late_payments?: number | null
          on_time_payments?: number | null
          payment_terms?: string | null
          reports_to_bureaus?: boolean | null
          total_payments?: number | null
          updated_at?: string | null
          user_id: string
          vendor_name: string
          vendor_type: string
        }
        Update: {
          account_number?: string | null
          account_opened_date?: string | null
          business_id?: string | null
          created_at?: string | null
          credit_limit?: number | null
          early_payments?: number | null
          id?: string
          is_active?: boolean | null
          last_payment_date?: string | null
          late_payments?: number | null
          on_time_payments?: number | null
          payment_terms?: string | null
          reports_to_bureaus?: boolean | null
          total_payments?: number | null
          updated_at?: string | null
          user_id?: string
          vendor_name?: string
          vendor_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_vendors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verification_runs: {
        Row: {
          business_id: string | null
          completed_at: string | null
          composite_score: number | null
          contact_id: string | null
          created_at: string
          error: string | null
          id: string
          mismatches: Json
          status: string
          summary: Json
          triggered_by: string
          triggered_by_user_id: string | null
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          composite_score?: number | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          mismatches?: Json
          status?: string
          summary?: Json
          triggered_by?: string
          triggered_by_user_id?: string | null
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          composite_score?: number | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          mismatches?: Json
          status?: string
          summary?: Json
          triggered_by?: string
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_verification_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_verification_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_verification_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "business_verification_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "business_verification_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verifications: {
        Row: {
          business_id: string | null
          confidence: number | null
          created_at: string
          error: string | null
          id: string
          matched_fields: string[]
          mismatched_fields: string[]
          normalized: Json
          raw_payload: Json
          run_id: string
          source: string
          source_kind: string
          source_url: string | null
          status: string
        }
        Insert: {
          business_id?: string | null
          confidence?: number | null
          created_at?: string
          error?: string | null
          id?: string
          matched_fields?: string[]
          mismatched_fields?: string[]
          normalized?: Json
          raw_payload?: Json
          run_id: string
          source: string
          source_kind?: string
          source_url?: string | null
          status?: string
        }
        Update: {
          business_id?: string | null
          confidence?: number | null
          created_at?: string
          error?: string | null
          id?: string
          matched_fields?: string[]
          mismatched_fields?: string[]
          normalized?: Json
          raw_payload?: Json
          run_id?: string
          source?: string
          source_kind?: string
          source_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_verifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_verifications_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "business_verification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          bank_account_opened_date: string | null
          bank_name: string | null
          build_assessed_at: string | null
          build_assessment_answers: Json | null
          build_score: number | null
          business_address_type: string | null
          business_city: string | null
          business_credit_last_updated: string | null
          business_email: string | null
          business_phone: string | null
          business_state: string | null
          business_street_address: string | null
          business_type:
            | Database["public"]["Enums"]["business_hierarchy_type"]
            | null
          business_zip: string | null
          created_at: string | null
          dba: string | null
          display_order: number | null
          dnb_delinquency_predictor: number | null
          dnb_delinquency_score: number | null
          dnb_duns: string | null
          dnb_duns_number: string | null
          dnb_failure_score: number | null
          dnb_financial_stress_score: number | null
          dnb_last_verified: string | null
          dnb_paydex: number | null
          dnb_paydex_score: number | null
          dnb_report_date: string | null
          ein: string | null
          employee_count: number | null
          entity_role: string | null
          entity_type: Database["public"]["Enums"]["entity_type"] | null
          equifax_credit_risk: number | null
          equifax_failure_score: number | null
          equifax_last_verified: string | null
          equifax_payment_index: number | null
          equifax_payment_index_score: number | null
          equifax_report_date: string | null
          equifax_sbfe_score: number | null
          estimated_annual_revenue: number | null
          experian_days_beyond_terms: number | null
          experian_financial_stability_risk: number | null
          experian_intelliscore: number | null
          experian_intelliscore_score: number | null
          experian_last_verified: string | null
          experian_report_date: string | null
          fico_sbss: number | null
          fico_sbss_last_verified: string | null
          formation_date: string | null
          formation_status: string | null
          has_8a_certification: boolean | null
          has_bank_account: boolean | null
          has_vetcert_certification: boolean | null
          has_wosb_certification: boolean | null
          id: string
          is_active: boolean
          is_hubzone_located: boolean | null
          is_minority_owned: boolean | null
          is_primary: boolean
          is_service_disabled_veteran_owned: boolean | null
          is_veteran_owned: boolean | null
          is_women_owned: boolean | null
          legal_name: string
          naics: string | null
          organizational_level: number | null
          owner_user_id: string
          parent_business_id: string | null
          phone_411_listed: boolean | null
          registered_agent_address: string | null
          registered_agent_name: string | null
          registered_agent_renewal_date: string | null
          registered_agent_state: string | null
          revenue_band: string | null
          state_of_formation: string | null
          tenant_id: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          bank_account_opened_date?: string | null
          bank_name?: string | null
          build_assessed_at?: string | null
          build_assessment_answers?: Json | null
          build_score?: number | null
          business_address_type?: string | null
          business_city?: string | null
          business_credit_last_updated?: string | null
          business_email?: string | null
          business_phone?: string | null
          business_state?: string | null
          business_street_address?: string | null
          business_type?:
            | Database["public"]["Enums"]["business_hierarchy_type"]
            | null
          business_zip?: string | null
          created_at?: string | null
          dba?: string | null
          display_order?: number | null
          dnb_delinquency_predictor?: number | null
          dnb_delinquency_score?: number | null
          dnb_duns?: string | null
          dnb_duns_number?: string | null
          dnb_failure_score?: number | null
          dnb_financial_stress_score?: number | null
          dnb_last_verified?: string | null
          dnb_paydex?: number | null
          dnb_paydex_score?: number | null
          dnb_report_date?: string | null
          ein?: string | null
          employee_count?: number | null
          entity_role?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"] | null
          equifax_credit_risk?: number | null
          equifax_failure_score?: number | null
          equifax_last_verified?: string | null
          equifax_payment_index?: number | null
          equifax_payment_index_score?: number | null
          equifax_report_date?: string | null
          equifax_sbfe_score?: number | null
          estimated_annual_revenue?: number | null
          experian_days_beyond_terms?: number | null
          experian_financial_stability_risk?: number | null
          experian_intelliscore?: number | null
          experian_intelliscore_score?: number | null
          experian_last_verified?: string | null
          experian_report_date?: string | null
          fico_sbss?: number | null
          fico_sbss_last_verified?: string | null
          formation_date?: string | null
          formation_status?: string | null
          has_8a_certification?: boolean | null
          has_bank_account?: boolean | null
          has_vetcert_certification?: boolean | null
          has_wosb_certification?: boolean | null
          id?: string
          is_active?: boolean
          is_hubzone_located?: boolean | null
          is_minority_owned?: boolean | null
          is_primary?: boolean
          is_service_disabled_veteran_owned?: boolean | null
          is_veteran_owned?: boolean | null
          is_women_owned?: boolean | null
          legal_name: string
          naics?: string | null
          organizational_level?: number | null
          owner_user_id: string
          parent_business_id?: string | null
          phone_411_listed?: boolean | null
          registered_agent_address?: string | null
          registered_agent_name?: string | null
          registered_agent_renewal_date?: string | null
          registered_agent_state?: string | null
          revenue_band?: string | null
          state_of_formation?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          bank_account_opened_date?: string | null
          bank_name?: string | null
          build_assessed_at?: string | null
          build_assessment_answers?: Json | null
          build_score?: number | null
          business_address_type?: string | null
          business_city?: string | null
          business_credit_last_updated?: string | null
          business_email?: string | null
          business_phone?: string | null
          business_state?: string | null
          business_street_address?: string | null
          business_type?:
            | Database["public"]["Enums"]["business_hierarchy_type"]
            | null
          business_zip?: string | null
          created_at?: string | null
          dba?: string | null
          display_order?: number | null
          dnb_delinquency_predictor?: number | null
          dnb_delinquency_score?: number | null
          dnb_duns?: string | null
          dnb_duns_number?: string | null
          dnb_failure_score?: number | null
          dnb_financial_stress_score?: number | null
          dnb_last_verified?: string | null
          dnb_paydex?: number | null
          dnb_paydex_score?: number | null
          dnb_report_date?: string | null
          ein?: string | null
          employee_count?: number | null
          entity_role?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"] | null
          equifax_credit_risk?: number | null
          equifax_failure_score?: number | null
          equifax_last_verified?: string | null
          equifax_payment_index?: number | null
          equifax_payment_index_score?: number | null
          equifax_report_date?: string | null
          equifax_sbfe_score?: number | null
          estimated_annual_revenue?: number | null
          experian_days_beyond_terms?: number | null
          experian_financial_stability_risk?: number | null
          experian_intelliscore?: number | null
          experian_intelliscore_score?: number | null
          experian_last_verified?: string | null
          experian_report_date?: string | null
          fico_sbss?: number | null
          fico_sbss_last_verified?: string | null
          formation_date?: string | null
          formation_status?: string | null
          has_8a_certification?: boolean | null
          has_bank_account?: boolean | null
          has_vetcert_certification?: boolean | null
          has_wosb_certification?: boolean | null
          id?: string
          is_active?: boolean
          is_hubzone_located?: boolean | null
          is_minority_owned?: boolean | null
          is_primary?: boolean
          is_service_disabled_veteran_owned?: boolean | null
          is_veteran_owned?: boolean | null
          is_women_owned?: boolean | null
          legal_name?: string
          naics?: string | null
          organizational_level?: number | null
          owner_user_id?: string
          parent_business_id?: string | null
          phone_411_listed?: boolean | null
          registered_agent_address?: string | null
          registered_agent_name?: string | null
          registered_agent_renewal_date?: string | null
          registered_agent_state?: string | null
          revenue_band?: string | null
          state_of_formation?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_parent_business_id_fkey"
            columns: ["parent_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "businesses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          name: string
          slug: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name: string
          slug: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name?: string
          slug?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_hosts: {
        Row: {
          availability_json: Json | null
          calendar_id: string
          created_at: string
          priority: number
          timezone: string | null
          user_id: string
        }
        Insert: {
          availability_json?: Json | null
          calendar_id: string
          created_at?: string
          priority?: number
          timezone?: string | null
          user_id: string
        }
        Update: {
          availability_json?: Json | null
          calendar_id?: string
          created_at?: string
          priority?: number
          timezone?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_hosts_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      calendars: {
        Row: {
          accent: string | null
          appointment_types: Json
          archived_at: string | null
          assignment_strategy: Json
          availability_json: Json | null
          booking_horizon_days: number
          buffer_after_min: number
          buffer_before_min: number
          capacity: number
          color: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          date_overrides: Json
          description: string | null
          duration_min: number
          enabled: boolean
          group_id: string | null
          id: string
          intake_questions: Json
          location_options: Json | null
          location_type: string
          location_value: string | null
          logo_url: string | null
          min_notice_min: number
          notify_config: Json
          published_at: string | null
          redirect_url: string | null
          show_company_name: boolean
          slug: string
          subtitle: string | null
          tenant_id: string | null
          theme: string
          timezone: string
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          accent?: string | null
          appointment_types?: Json
          archived_at?: string | null
          assignment_strategy?: Json
          availability_json?: Json | null
          booking_horizon_days?: number
          buffer_after_min?: number
          buffer_before_min?: number
          capacity?: number
          color?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          date_overrides?: Json
          description?: string | null
          duration_min?: number
          enabled?: boolean
          group_id?: string | null
          id?: string
          intake_questions?: Json
          location_options?: Json | null
          location_type?: string
          location_value?: string | null
          logo_url?: string | null
          min_notice_min?: number
          notify_config?: Json
          published_at?: string | null
          redirect_url?: string | null
          show_company_name?: boolean
          slug: string
          subtitle?: string | null
          tenant_id?: string | null
          theme?: string
          timezone?: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          accent?: string | null
          appointment_types?: Json
          archived_at?: string | null
          assignment_strategy?: Json
          availability_json?: Json | null
          booking_horizon_days?: number
          buffer_after_min?: number
          buffer_before_min?: number
          capacity?: number
          color?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          date_overrides?: Json
          description?: string | null
          duration_min?: number
          enabled?: boolean
          group_id?: string | null
          id?: string
          intake_questions?: Json
          location_options?: Json | null
          location_type?: string
          location_value?: string | null
          logo_url?: string | null
          min_notice_min?: number
          notify_config?: Json
          published_at?: string | null
          redirect_url?: string | null
          show_company_name?: boolean
          slug?: string
          subtitle?: string | null
          tenant_id?: string | null
          theme?: string
          timezone?: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendars_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "calendar_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_embeddings: {
        Row: {
          client_user_id: string | null
          content_excerpt: string
          created_at: string
          embedding: string | null
          id: string
          message_id: string
          role: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          client_user_id?: string | null
          content_excerpt: string
          created_at?: string
          embedding?: string | null
          id?: string
          message_id: string
          role: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          client_user_id?: string | null
          content_excerpt?: string
          created_at?: string
          embedding?: string | null
          id?: string
          message_id?: string
          role?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_embeddings_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          audio_transcript: string | null
          content: string
          created_at: string
          function_call: Json | null
          id: string
          metadata: Json | null
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          audio_transcript?: string | null
          content: string
          created_at?: string
          function_call?: Json | null
          id?: string
          metadata?: Json | null
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          audio_transcript?: string | null
          content?: string
          created_at?: string
          function_call?: Json | null
          id?: string
          metadata?: Json | null
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      client_custom_field_values: {
        Row: {
          client_id: string
          created_at: string
          field_definition_id: string
          id: string
          tenant_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          client_id: string
          created_at?: string
          field_definition_id: string
          id?: string
          tenant_id: string
          updated_at?: string
          value?: Json
        }
        Update: {
          client_id?: string
          created_at?: string
          field_definition_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "client_custom_field_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_custom_field_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_custom_field_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_custom_field_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_custom_field_values_field_definition_id_fkey"
            columns: ["field_definition_id"]
            isOneToOne: false
            referencedRelation: "custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_custom_field_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_files: {
        Row: {
          contact_id: string
          created_at: string
          description: string | null
          id: string
          mime_type: string | null
          original_filename: string
          size_bytes: number | null
          storage_path: string
          tenant_id: string | null
          updated_at: string
          uploaded_by_user_id: string
          visibility: Database["public"]["Enums"]["client_file_visibility"]
        }
        Insert: {
          contact_id: string
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          original_filename: string
          size_bytes?: number | null
          storage_path: string
          tenant_id?: string | null
          updated_at?: string
          uploaded_by_user_id: string
          visibility?: Database["public"]["Enums"]["client_file_visibility"]
        }
        Update: {
          contact_id?: string
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          original_filename?: string
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string | null
          updated_at?: string
          uploaded_by_user_id?: string
          visibility?: Database["public"]["Enums"]["client_file_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "client_files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goals: {
        Row: {
          created_at: string
          goal_category: string
          goal_description: string | null
          id: string
          progress_notes: string | null
          status: string
          target_amount: number | null
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_category: string
          goal_description?: string | null
          id?: string
          progress_notes?: string | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal_category?: string
          goal_description?: string | null
          id?: string
          progress_notes?: string | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_memory: {
        Row: {
          client_id: string | null
          client_user_id: string
          content: string
          created_at: string
          embedding: string | null
          id: string
          is_active: boolean
          memory_type: string
          metadata: Json | null
          source_session_id: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_user_id: string
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          memory_type: string
          metadata?: Json | null
          source_session_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_user_id?: string
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          memory_type?: string
          metadata?: Json | null
          source_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          author_user_id: string
          body: string
          contact_id: string
          created_at: string
          id: string
          pinned: boolean
          tags: string[]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          contact_id: string
          created_at?: string
          id?: string
          pinned?: boolean
          tags?: string[]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          contact_id?: string
          created_at?: string
          id?: string
          pinned?: boolean
          tags?: string[]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "client_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_number: string | null
          agreement_signed_at: string | null
          assigned_coach_user_id: string | null
          city: string | null
          created_at: string
          created_by: string
          cs_primary_user_id: string | null
          current_notes: string | null
          do_not_contact: boolean
          email: string | null
          entity_name: string | null
          entity_type: string | null
          first_name: string
          funding_goal: number | null
          ghl_contact_id: string | null
          id: string
          journey_stage_entered_at: string | null
          journey_stage_id: number | null
          last_contacted_at: string | null
          last_mirrored_at: string | null
          last_name: string
          lead_owner_user_id: string | null
          lead_score: number
          lifecycle_stage: string
          linked_user_id: string | null
          linkedin_url: string | null
          mirror_source: string | null
          monthly_revenue: number | null
          onboarding_completed_at: string | null
          onboarding_stage: string | null
          onboarding_started_at: string | null
          paige_shared_context_consent: boolean
          paige_shared_context_consent_updated_at: string | null
          phone: string | null
          primary_business_id: string | null
          primary_offer: string | null
          source: string | null
          state: string | null
          status: string
          street_address: string | null
          tags: string[]
          tenant_id: string | null
          tier: string | null
          title: string | null
          updated_at: string
          website: string | null
          zip_code: string | null
        }
        Insert: {
          account_number?: string | null
          agreement_signed_at?: string | null
          assigned_coach_user_id?: string | null
          city?: string | null
          created_at?: string
          created_by: string
          cs_primary_user_id?: string | null
          current_notes?: string | null
          do_not_contact?: boolean
          email?: string | null
          entity_name?: string | null
          entity_type?: string | null
          first_name: string
          funding_goal?: number | null
          ghl_contact_id?: string | null
          id?: string
          journey_stage_entered_at?: string | null
          journey_stage_id?: number | null
          last_contacted_at?: string | null
          last_mirrored_at?: string | null
          last_name: string
          lead_owner_user_id?: string | null
          lead_score?: number
          lifecycle_stage?: string
          linked_user_id?: string | null
          linkedin_url?: string | null
          mirror_source?: string | null
          monthly_revenue?: number | null
          onboarding_completed_at?: string | null
          onboarding_stage?: string | null
          onboarding_started_at?: string | null
          paige_shared_context_consent?: boolean
          paige_shared_context_consent_updated_at?: string | null
          phone?: string | null
          primary_business_id?: string | null
          primary_offer?: string | null
          source?: string | null
          state?: string | null
          status?: string
          street_address?: string | null
          tags?: string[]
          tenant_id?: string | null
          tier?: string | null
          title?: string | null
          updated_at?: string
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          account_number?: string | null
          agreement_signed_at?: string | null
          assigned_coach_user_id?: string | null
          city?: string | null
          created_at?: string
          created_by?: string
          cs_primary_user_id?: string | null
          current_notes?: string | null
          do_not_contact?: boolean
          email?: string | null
          entity_name?: string | null
          entity_type?: string | null
          first_name?: string
          funding_goal?: number | null
          ghl_contact_id?: string | null
          id?: string
          journey_stage_entered_at?: string | null
          journey_stage_id?: number | null
          last_contacted_at?: string | null
          last_mirrored_at?: string | null
          last_name?: string
          lead_owner_user_id?: string | null
          lead_score?: number
          lifecycle_stage?: string
          linked_user_id?: string | null
          linkedin_url?: string | null
          mirror_source?: string | null
          monthly_revenue?: number | null
          onboarding_completed_at?: string | null
          onboarding_stage?: string | null
          onboarding_started_at?: string | null
          paige_shared_context_consent?: boolean
          paige_shared_context_consent_updated_at?: string | null
          phone?: string | null
          primary_business_id?: string | null
          primary_offer?: string | null
          source?: string | null
          state?: string | null
          status?: string
          street_address?: string | null
          tags?: string[]
          tenant_id?: string | null
          tier?: string | null
          title?: string | null
          updated_at?: string
          website?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_journey_stage_id_fkey"
            columns: ["journey_stage_id"]
            isOneToOne: false
            referencedRelation: "paige_journey_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_primary_business_id_fkey"
            columns: ["primary_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_clients: {
        Row: {
          client_user_id: string
          coach_user_id: string
          created_at: string
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          coach_user_id: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      commission_payments: {
        Row: {
          affiliate_id: string
          amount_cents: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
        }
        Insert: {
          affiliate_id: string
          amount_cents: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
        }
        Update: {
          affiliate_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_payments_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "v_affiliate_stats"
            referencedColumns: ["affiliate_id"]
          },
        ]
      }
      communication_log: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          id: string
          message_type: string
          preview: string | null
          provider_message_id: string | null
          status: string
          subject: string | null
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type: string
          preview?: string | null
          provider_message_id?: string | null
          status: string
          subject?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type?: string
          preview?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      communication_preferences: {
        Row: {
          created_at: string
          email_affiliate_program: boolean
          email_coaching_reminders: boolean
          email_credit_alerts: boolean
          email_enabled: boolean
          email_funding_alerts: boolean
          email_onboarding: boolean
          email_score_milestones: boolean
          email_weekly_summary: boolean
          id: string
          sms_coaching_reminders: boolean
          sms_credit_alerts: boolean
          sms_enabled: boolean
          sms_funding_alerts: boolean
          sms_phone_number: string | null
          sms_phone_verified: boolean
          sms_score_milestones: boolean
          unsubscribed_all: boolean
          unsubscribed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_affiliate_program?: boolean
          email_coaching_reminders?: boolean
          email_credit_alerts?: boolean
          email_enabled?: boolean
          email_funding_alerts?: boolean
          email_onboarding?: boolean
          email_score_milestones?: boolean
          email_weekly_summary?: boolean
          id?: string
          sms_coaching_reminders?: boolean
          sms_credit_alerts?: boolean
          sms_enabled?: boolean
          sms_funding_alerts?: boolean
          sms_phone_number?: string | null
          sms_phone_verified?: boolean
          sms_score_milestones?: boolean
          unsubscribed_all?: boolean
          unsubscribed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_affiliate_program?: boolean
          email_coaching_reminders?: boolean
          email_credit_alerts?: boolean
          email_enabled?: boolean
          email_funding_alerts?: boolean
          email_onboarding?: boolean
          email_score_milestones?: boolean
          email_weekly_summary?: boolean
          id?: string
          sms_coaching_reminders?: boolean
          sms_credit_alerts?: boolean
          sms_enabled?: boolean
          sms_funding_alerts?: boolean
          sms_phone_number?: string | null
          sms_phone_verified?: boolean
          sms_score_milestones?: boolean
          unsubscribed_all?: boolean
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      communications_consents: {
        Row: {
          contact_id: string | null
          created_at: string
          document_slug: string
          document_version: number
          email: string | null
          email_marketing: boolean
          email_transactional: boolean
          id: string
          ip_address: string | null
          phone: string | null
          sms_marketing: boolean
          sms_transactional: boolean
          source: string
          tenant_id: string | null
          updated_at: string
          user_agent: string | null
          user_id: string | null
          voice_marketing: boolean
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          document_slug?: string
          document_version?: number
          email?: string | null
          email_marketing?: boolean
          email_transactional?: boolean
          id?: string
          ip_address?: string | null
          phone?: string | null
          sms_marketing?: boolean
          sms_transactional?: boolean
          source: string
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
          voice_marketing?: boolean
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          document_slug?: string
          document_version?: number
          email?: string | null
          email_marketing?: boolean
          email_transactional?: boolean
          id?: string
          ip_address?: string | null
          phone?: string | null
          sms_marketing?: boolean
          sms_transactional?: boolean
          source?: string
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
          voice_marketing?: boolean
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: []
      }
      compliance_checkpoints: {
        Row: {
          api_endpoint: string | null
          checkpoint_type: string
          consent_event_id: string | null
          created_at: string
          error_message: string | null
          id: string
          status: string
          user_id: string
          validation_result: Json | null
        }
        Insert: {
          api_endpoint?: string | null
          checkpoint_type: string
          consent_event_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          user_id: string
          validation_result?: Json | null
        }
        Update: {
          api_endpoint?: string | null
          checkpoint_type?: string
          consent_event_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          user_id?: string
          validation_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_checkpoints_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_bank_account_secrets: {
        Row: {
          account_row_id: string
          created_at: string
          plaid_access_token_ct: string | null
          updated_at: string
        }
        Insert: {
          account_row_id: string
          created_at?: string
          plaid_access_token_ct?: string | null
          updated_at?: string
        }
        Update: {
          account_row_id?: string
          created_at?: string
          plaid_access_token_ct?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_bank_account_secrets_account_row_id_fkey"
            columns: ["account_row_id"]
            isOneToOne: true
            referencedRelation: "connected_bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_bank_accounts: {
        Row: {
          account_id: string
          account_mask: string | null
          account_name: string | null
          account_subtype: string | null
          account_type: string | null
          business_id: string | null
          created_at: string | null
          id: string
          institution_id: string
          institution_name: string
          is_active: boolean | null
          last_sync_at: string | null
          plaid_item_id: string
          transactions_cursor: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          account_mask?: string | null
          account_name?: string | null
          account_subtype?: string | null
          account_type?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          institution_id: string
          institution_name: string
          is_active?: boolean | null
          last_sync_at?: string | null
          plaid_item_id: string
          transactions_cursor?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          account_mask?: string | null
          account_name?: string | null
          account_subtype?: string | null
          account_type?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          institution_id?: string
          institution_name?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          plaid_item_id?: string
          transactions_cursor?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_bank_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_events: {
        Row: {
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at: string
          disclosure_version: string
          granted: boolean
          id: string
          ip_address: string | null
          metadata: Json | null
          session_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          disclosure_version: string
          granted?: boolean
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          session_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_type?: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          disclosure_version?: string
          granted?: boolean
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      conversation_context: {
        Row: {
          active_scope: string | null
          context_stack: Json | null
          created_at: string | null
          entities: Json | null
          expires_at: string | null
          id: string
          intent: string | null
          session_id: string
          turn_number: number
          user_id: string
          utterance: string
        }
        Insert: {
          active_scope?: string | null
          context_stack?: Json | null
          created_at?: string | null
          entities?: Json | null
          expires_at?: string | null
          id?: string
          intent?: string | null
          session_id: string
          turn_number?: number
          user_id: string
          utterance: string
        }
        Update: {
          active_scope?: string | null
          context_stack?: Json | null
          created_at?: string | null
          entities?: Json | null
          expires_at?: string | null
          id?: string
          intent?: string | null
          session_id?: string
          turn_number?: number
          user_id?: string
          utterance?: string
        }
        Relationships: []
      }
      corporate_entity_registry: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          ip_licensor_slug: string | null
          is_active: boolean
          lane: string | null
          lane_separated: boolean
          legal_name: string
          notes: string | null
          parent_slug: string | null
          role: string
          slug: string
          state_of_formation: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          ip_licensor_slug?: string | null
          is_active?: boolean
          lane?: string | null
          lane_separated?: boolean
          legal_name: string
          notes?: string | null
          parent_slug?: string | null
          role: string
          slug: string
          state_of_formation: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          ip_licensor_slug?: string | null
          is_active?: boolean
          lane?: string | null
          lane_separated?: boolean
          legal_name?: string
          notes?: string | null
          parent_slug?: string | null
          role?: string
          slug?: string
          state_of_formation?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_certificates: {
        Row: {
          certificate_url: string | null
          course_id: string
          created_at: string
          id: string
          issued_at: string
          user_id: string
          verification_code: string
        }
        Insert: {
          certificate_url?: string | null
          course_id: string
          created_at?: string
          id?: string
          issued_at?: string
          user_id: string
          verification_code?: string
        }
        Update: {
          certificate_url?: string | null
          course_id?: string
          created_at?: string
          id?: string
          issued_at?: string
          user_id?: string
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string | null
          description: string | null
          difficulty_level: string | null
          duration_minutes: number | null
          framework: string
          id: string
          is_active: boolean | null
          module_count: number | null
          sort_order: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          difficulty_level?: string | null
          duration_minutes?: number | null
          framework: string
          id?: string
          is_active?: boolean | null
          module_count?: number | null
          sort_order?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          difficulty_level?: string | null
          duration_minutes?: number | null
          framework?: string
          id?: string
          is_active?: boolean | null
          module_count?: number | null
          sort_order?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      credit_accounts: {
        Row: {
          account_close_date: string | null
          account_number: string | null
          account_open_date: string | null
          balance: number | null
          bureau_source: string | null
          client_id: string | null
          created_at: string | null
          credit_limit: number | null
          creditor: string
          current_balance: number | null
          duplicate_of_id: string | null
          id: string
          is_authorized_user: boolean | null
          is_disputed_ownership: boolean | null
          is_open: boolean | null
          last_reported_date: string | null
          limit_amount: number | null
          needs_review: boolean
          opened_on: string | null
          original_amount: number | null
          payment_history_json: Json | null
          status: string | null
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string | null
          user_id: string
          utilization: number | null
          validation_flags: Json | null
        }
        Insert: {
          account_close_date?: string | null
          account_number?: string | null
          account_open_date?: string | null
          balance?: number | null
          bureau_source?: string | null
          client_id?: string | null
          created_at?: string | null
          credit_limit?: number | null
          creditor: string
          current_balance?: number | null
          duplicate_of_id?: string | null
          id?: string
          is_authorized_user?: boolean | null
          is_disputed_ownership?: boolean | null
          is_open?: boolean | null
          last_reported_date?: string | null
          limit_amount?: number | null
          needs_review?: boolean
          opened_on?: string | null
          original_amount?: number | null
          payment_history_json?: Json | null
          status?: string | null
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string | null
          user_id: string
          utilization?: number | null
          validation_flags?: Json | null
        }
        Update: {
          account_close_date?: string | null
          account_number?: string | null
          account_open_date?: string | null
          balance?: number | null
          bureau_source?: string | null
          client_id?: string | null
          created_at?: string | null
          credit_limit?: number | null
          creditor?: string
          current_balance?: number | null
          duplicate_of_id?: string | null
          id?: string
          is_authorized_user?: boolean | null
          is_disputed_ownership?: boolean | null
          is_open?: boolean | null
          last_reported_date?: string | null
          limit_amount?: number | null
          needs_review?: boolean
          opened_on?: string | null
          original_amount?: number | null
          payment_history_json?: Json | null
          status?: string | null
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string | null
          user_id?: string
          utilization?: number | null
          validation_flags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_accounts_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_alerts: {
        Row: {
          alert_description: string
          alert_severity: string
          alert_title: string
          alert_type: string
          bureau: string | null
          client_id: string
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          is_dismissed: boolean
          is_read: boolean
          new_value: string | null
          previous_value: string | null
          read_at: string | null
          related_account_id: string | null
        }
        Insert: {
          alert_description: string
          alert_severity: string
          alert_title: string
          alert_type: string
          bureau?: string | null
          client_id: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          new_value?: string | null
          previous_value?: string | null
          read_at?: string | null
          related_account_id?: string | null
        }
        Update: {
          alert_description?: string
          alert_severity?: string
          alert_title?: string
          alert_type?: string
          bureau?: string | null
          client_id?: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          new_value?: string | null
          previous_value?: string | null
          read_at?: string | null
          related_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_profiles_safe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_alerts_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "coach_client_profiles_safe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_alerts_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_factor_scores: {
        Row: {
          active_negatives: number | null
          aggregate_utilization: number | null
          average_account_age_months: number | null
          calculated_at: string | null
          cards_over_30_pct: number | null
          cards_over_50_pct: number | null
          cards_over_70_pct: number | null
          client_id: string | null
          credit_age_score: number | null
          credit_mix_score: number | null
          data_sources: Json | null
          id: string
          inquiry_budget_remaining: number | null
          inquiry_score: number | null
          installment_count: number | null
          mortgage_count: number | null
          newest_account_age_months: number | null
          oldest_account_age_months: number | null
          oldest_negative_date: string | null
          overall_fundability_score: number | null
          payment_history_score: number | null
          removed_negatives: number | null
          revolving_count: number | null
          total_balance: number | null
          total_credit_limit: number | null
          total_inquiries_eq: number | null
          total_inquiries_ex: number | null
          total_inquiries_tu: number | null
          total_negatives: number | null
          user_id: string
          utilization_score: number | null
        }
        Insert: {
          active_negatives?: number | null
          aggregate_utilization?: number | null
          average_account_age_months?: number | null
          calculated_at?: string | null
          cards_over_30_pct?: number | null
          cards_over_50_pct?: number | null
          cards_over_70_pct?: number | null
          client_id?: string | null
          credit_age_score?: number | null
          credit_mix_score?: number | null
          data_sources?: Json | null
          id?: string
          inquiry_budget_remaining?: number | null
          inquiry_score?: number | null
          installment_count?: number | null
          mortgage_count?: number | null
          newest_account_age_months?: number | null
          oldest_account_age_months?: number | null
          oldest_negative_date?: string | null
          overall_fundability_score?: number | null
          payment_history_score?: number | null
          removed_negatives?: number | null
          revolving_count?: number | null
          total_balance?: number | null
          total_credit_limit?: number | null
          total_inquiries_eq?: number | null
          total_inquiries_ex?: number | null
          total_inquiries_tu?: number | null
          total_negatives?: number | null
          user_id: string
          utilization_score?: number | null
        }
        Update: {
          active_negatives?: number | null
          aggregate_utilization?: number | null
          average_account_age_months?: number | null
          calculated_at?: string | null
          cards_over_30_pct?: number | null
          cards_over_50_pct?: number | null
          cards_over_70_pct?: number | null
          client_id?: string | null
          credit_age_score?: number | null
          credit_mix_score?: number | null
          data_sources?: Json | null
          id?: string
          inquiry_budget_remaining?: number | null
          inquiry_score?: number | null
          installment_count?: number | null
          mortgage_count?: number | null
          newest_account_age_months?: number | null
          oldest_account_age_months?: number | null
          oldest_negative_date?: string | null
          overall_fundability_score?: number | null
          payment_history_score?: number | null
          removed_negatives?: number | null
          revolving_count?: number | null
          total_balance?: number | null
          total_credit_limit?: number | null
          total_inquiries_eq?: number | null
          total_inquiries_ex?: number | null
          total_inquiries_tu?: number | null
          total_negatives?: number | null
          user_id?: string
          utilization_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_factor_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_factor_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_factor_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_factor_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_inquiries: {
        Row: {
          bureau: string
          created_at: string | null
          creditor_name: string
          dispute_id: string | null
          fall_off_date: string | null
          id: string
          inquiry_date: string
          is_authorized: boolean | null
          is_rate_shopping: boolean | null
          rate_shopping_group_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          bureau: string
          created_at?: string | null
          creditor_name: string
          dispute_id?: string | null
          fall_off_date?: string | null
          id?: string
          inquiry_date: string
          is_authorized?: boolean | null
          is_rate_shopping?: boolean | null
          rate_shopping_group_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          bureau?: string
          created_at?: string | null
          creditor_name?: string
          dispute_id?: string | null
          fall_off_date?: string | null
          id?: string
          inquiry_date?: string
          is_authorized?: boolean | null
          is_rate_shopping?: boolean | null
          rate_shopping_group_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      credit_negative_items: {
        Row: {
          account_number: string | null
          account_number_masked: string | null
          amount: number | null
          bureau: string
          client_id: string | null
          created_at: string | null
          creditor_name: string | null
          date_of_occurrence: string | null
          date_reported: string | null
          dispute_id: string | null
          duplicate_of_id: string | null
          id: string
          is_disputed_ownership: boolean | null
          is_removable: boolean | null
          item_type: string
          needs_review: boolean
          notes: string | null
          original_amount: number | null
          removal_probability: number | null
          removal_reason: string | null
          status: string | null
          updated_at: string | null
          user_id: string
          validation_flags: Json | null
        }
        Insert: {
          account_number?: string | null
          account_number_masked?: string | null
          amount?: number | null
          bureau: string
          client_id?: string | null
          created_at?: string | null
          creditor_name?: string | null
          date_of_occurrence?: string | null
          date_reported?: string | null
          dispute_id?: string | null
          duplicate_of_id?: string | null
          id?: string
          is_disputed_ownership?: boolean | null
          is_removable?: boolean | null
          item_type: string
          needs_review?: boolean
          notes?: string | null
          original_amount?: number | null
          removal_probability?: number | null
          removal_reason?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          validation_flags?: Json | null
        }
        Update: {
          account_number?: string | null
          account_number_masked?: string | null
          amount?: number | null
          bureau?: string
          client_id?: string | null
          created_at?: string | null
          creditor_name?: string | null
          date_of_occurrence?: string | null
          date_reported?: string | null
          dispute_id?: string | null
          duplicate_of_id?: string | null
          id?: string
          is_disputed_ownership?: boolean | null
          is_removable?: boolean | null
          item_type?: string
          needs_review?: boolean
          notes?: string | null
          original_amount?: number | null
          removal_probability?: number | null
          removal_reason?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          validation_flags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_negative_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_negative_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_negative_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_negative_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_negative_items_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "credit_negative_items"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_predictions: {
        Row: {
          account_id: string | null
          action_required: string | null
          action_url: string | null
          bureau: string | null
          confidence: Database["public"]["Enums"]["credit_prediction_confidence"]
          created_at: string
          deadline_date: string | null
          description: string
          expires_at: string | null
          id: string
          impact_score: number | null
          is_acted_on: boolean
          is_dismissed: boolean
          metadata: Json | null
          prediction_type: Database["public"]["Enums"]["credit_prediction_type"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          action_required?: string | null
          action_url?: string | null
          bureau?: string | null
          confidence?: Database["public"]["Enums"]["credit_prediction_confidence"]
          created_at?: string
          deadline_date?: string | null
          description: string
          expires_at?: string | null
          id?: string
          impact_score?: number | null
          is_acted_on?: boolean
          is_dismissed?: boolean
          metadata?: Json | null
          prediction_type: Database["public"]["Enums"]["credit_prediction_type"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          action_required?: string | null
          action_url?: string | null
          bureau?: string | null
          confidence?: Database["public"]["Enums"]["credit_prediction_confidence"]
          created_at?: string
          deadline_date?: string | null
          description?: string
          expires_at?: string | null
          id?: string
          impact_score?: number | null
          is_acted_on?: boolean
          is_dismissed?: boolean
          metadata?: Json | null
          prediction_type?: Database["public"]["Enums"]["credit_prediction_type"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_predictions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_report_personal_info: {
        Row: {
          bureau_source: string
          client_id: string | null
          created_at: string
          credit_report_upload_id: string
          date_range: string | null
          extracted_at: string
          field_type: string
          field_value: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bureau_source: string
          client_id?: string | null
          created_at?: string
          credit_report_upload_id: string
          date_range?: string | null
          extracted_at?: string
          field_type: string
          field_value: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bureau_source?: string
          client_id?: string | null
          created_at?: string
          credit_report_upload_id?: string
          date_range?: string | null
          extracted_at?: string
          field_type?: string
          field_value?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_report_personal_info_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_report_personal_info_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_report_personal_info_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_report_personal_info_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_report_personal_info_credit_report_upload_id_fkey"
            columns: ["credit_report_upload_id"]
            isOneToOne: false
            referencedRelation: "credit_report_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_report_uploads: {
        Row: {
          analysis_result: Json | null
          analysis_status: string
          backfill_completed_at: string | null
          backfill_fields_updated: Json | null
          backfill_status: string | null
          bureau_detected: string | null
          client_id: string | null
          created_at: string
          error_message: string | null
          estimated_score_impact: number | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          last_analyzed_at: string | null
          negative_items_extracted: Json | null
          positive_accounts_extracted: Json | null
          profile_summary: string | null
          report_type: string
          updated_at: string
          uploaded_by: string
          user_id: string
        }
        Insert: {
          analysis_result?: Json | null
          analysis_status?: string
          backfill_completed_at?: string | null
          backfill_fields_updated?: Json | null
          backfill_status?: string | null
          bureau_detected?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_score_impact?: number | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          last_analyzed_at?: string | null
          negative_items_extracted?: Json | null
          positive_accounts_extracted?: Json | null
          profile_summary?: string | null
          report_type?: string
          updated_at?: string
          uploaded_by: string
          user_id: string
        }
        Update: {
          analysis_result?: Json | null
          analysis_status?: string
          backfill_completed_at?: string | null
          backfill_fields_updated?: Json | null
          backfill_status?: string | null
          bureau_detected?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_score_impact?: number | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          last_analyzed_at?: string | null
          negative_items_extracted?: Json | null
          positive_accounts_extracted?: Json | null
          profile_summary?: string | null
          report_type?: string
          updated_at?: string
          uploaded_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_report_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_report_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_report_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "credit_report_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_report_verifications: {
        Row: {
          created_at: string | null
          date_of_birth: string | null
          equifax_api_user_id: string | null
          equifax_expires_at: string | null
          equifax_verified: boolean | null
          equifax_verified_at: string | null
          experian_api_user_id: string | null
          experian_expires_at: string | null
          experian_verified: boolean | null
          experian_verified_at: string | null
          id: string
          kba_attempts: number | null
          kba_completed: boolean | null
          kba_last_attempt_at: string | null
          ssn_last_4: string | null
          transunion_api_user_id: string | null
          transunion_expires_at: string | null
          transunion_verified: boolean | null
          transunion_verified_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date_of_birth?: string | null
          equifax_api_user_id?: string | null
          equifax_expires_at?: string | null
          equifax_verified?: boolean | null
          equifax_verified_at?: string | null
          experian_api_user_id?: string | null
          experian_expires_at?: string | null
          experian_verified?: boolean | null
          experian_verified_at?: string | null
          id?: string
          kba_attempts?: number | null
          kba_completed?: boolean | null
          kba_last_attempt_at?: string | null
          ssn_last_4?: string | null
          transunion_api_user_id?: string | null
          transunion_expires_at?: string | null
          transunion_verified?: boolean | null
          transunion_verified_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date_of_birth?: string | null
          equifax_api_user_id?: string | null
          equifax_expires_at?: string | null
          equifax_verified?: boolean | null
          equifax_verified_at?: string | null
          experian_api_user_id?: string | null
          experian_expires_at?: string | null
          experian_verified?: boolean | null
          experian_verified_at?: string | null
          id?: string
          kba_attempts?: number | null
          kba_completed?: boolean | null
          kba_last_attempt_at?: string | null
          ssn_last_4?: string | null
          transunion_api_user_id?: string | null
          transunion_expires_at?: string | null
          transunion_verified?: boolean | null
          transunion_verified_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      credit_utilization_snapshots: {
        Row: {
          balance: number | null
          created_at: string | null
          credit_account_id: string | null
          credit_limit: number | null
          id: string
          snapshot_date: string | null
          source: string | null
          user_id: string
          utilization_pct: number | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          credit_account_id?: string | null
          credit_limit?: number | null
          id?: string
          snapshot_date?: string | null
          source?: string | null
          user_id: string
          utilization_pct?: number | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          credit_account_id?: string | null
          credit_limit?: number | null
          id?: string
          snapshot_date?: string | null
          source?: string | null
          user_id?: string
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_utilization_snapshots_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          field_type: string
          help_text: string | null
          id: string
          key: string
          label: string
          object_type: string
          options: Json | null
          position: number
          required: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          field_type: string
          help_text?: string | null
          id?: string
          key: string
          label: string
          object_type?: string
          options?: Json | null
          position?: number
          required?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          field_type?: string
          help_text?: string | null
          id?: string
          key?: string
          label?: string
          object_type?: string
          options?: Json | null
          position?: number
          required?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          id: string
          metadata: Json | null
          requested_at: string
          status: string
          user_id: string
          verification_code: string | null
        }
        Insert: {
          completed_at?: string | null
          id?: string
          metadata?: Json | null
          requested_at?: string
          status?: string
          user_id: string
          verification_code?: string | null
        }
        Update: {
          completed_at?: string | null
          id?: string
          metadata?: Json | null
          requested_at?: string
          status?: string
          user_id?: string
          verification_code?: string | null
        }
        Relationships: []
      }
      deal_activities: {
        Row: {
          actor_user_id: string | null
          created_at: string
          deal_id: string
          id: string
          payload: Json
          summary: string | null
          type: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          payload?: Json
          summary?: string | null
          type: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          payload?: Json
          summary?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          actual_close_date: string | null
          contact_client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          expected_close_date: string | null
          id: string
          lost_reason: string | null
          notes: string | null
          offer_type: string | null
          owner_user_id: string | null
          pipeline_id: string
          source: string | null
          stage_id: string
          status: string
          tags: string[]
          tenant_id: string | null
          title: string
          updated_at: string
          value_cents: number
        }
        Insert: {
          actual_close_date?: string | null
          contact_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          offer_type?: string | null
          owner_user_id?: string | null
          pipeline_id: string
          source?: string | null
          stage_id: string
          status?: string
          tags?: string[]
          tenant_id?: string | null
          title: string
          updated_at?: string
          value_cents?: number
        }
        Update: {
          actual_close_date?: string | null
          contact_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          offer_type?: string | null
          owner_user_id?: string | null
          pipeline_id?: string
          source?: string | null
          stage_id?: string
          status?: string
          tags?: string[]
          tenant_id?: string | null
          title?: string
          updated_at?: string
          value_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_contact_client_id_fkey"
            columns: ["contact_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_client_id_fkey"
            columns: ["contact_client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "deals_contact_client_id_fkey"
            columns: ["contact_client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "deals_contact_client_id_fkey"
            columns: ["contact_client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      disclosure_templates: {
        Row: {
          content: string
          created_at: string | null
          disclosure_type: Database["public"]["Enums"]["disclosure_type"]
          effective_date: string
          id: string
          is_active: boolean | null
          metadata: Json | null
          title: string
          updated_at: string | null
          version: string
        }
        Insert: {
          content: string
          created_at?: string | null
          disclosure_type: Database["public"]["Enums"]["disclosure_type"]
          effective_date?: string
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title: string
          updated_at?: string | null
          version: string
        }
        Update: {
          content?: string
          created_at?: string | null
          disclosure_type?: Database["public"]["Enums"]["disclosure_type"]
          effective_date?: string
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          version?: string
        }
        Relationships: []
      }
      doctrine_120_canonical_columns: {
        Row: {
          canonical_columns: string[]
          created_at: string
          domain: string
          id: string
          mcp_tool_name: string | null
          notes: string | null
          table_name: string
          table_schema: string
          updated_at: string
        }
        Insert: {
          canonical_columns: string[]
          created_at?: string
          domain: string
          id?: string
          mcp_tool_name?: string | null
          notes?: string | null
          table_name: string
          table_schema?: string
          updated_at?: string
        }
        Update: {
          canonical_columns?: string[]
          created_at?: string
          domain?: string
          id?: string
          mcp_tool_name?: string | null
          notes?: string | null
          table_name?: string
          table_schema?: string
          updated_at?: string
        }
        Relationships: []
      }
      doctrine_120_canonical_enums: {
        Row: {
          canonical_values: string[]
          constraint_name: string
          constraint_schema: string
          constraint_table: string
          created_at: string
          domain: string
          id: string
          mcp_tool_name: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          canonical_values: string[]
          constraint_name: string
          constraint_schema?: string
          constraint_table: string
          created_at?: string
          domain: string
          id?: string
          mcp_tool_name?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          canonical_values?: string[]
          constraint_name?: string
          constraint_schema?: string
          constraint_table?: string
          created_at?: string
          domain?: string
          id?: string
          mcp_tool_name?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          bucket_name: string
          business_id: string | null
          client_id: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          folder_path: string | null
          id: string
          metadata: Json | null
          mime_type: string
          tags: string[] | null
          updated_at: string | null
          uploaded_at: string | null
          user_id: string
        }
        Insert: {
          bucket_name: string
          business_id?: string | null
          client_id?: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          folder_path?: string | null
          id?: string
          metadata?: Json | null
          mime_type: string
          tags?: string[] | null
          updated_at?: string | null
          uploaded_at?: string | null
          user_id: string
        }
        Update: {
          bucket_name?: string
          business_id?: string | null
          client_id?: string | null
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number
          folder_path?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string
          tags?: string[] | null
          updated_at?: string | null
          uploaded_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_rates_cache: {
        Row: {
          created_at: string
          expires_at: string
          fetched_at: string
          id: string
          observation_date: string
          series_id: string
          series_name: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          observation_date: string
          series_id: string
          series_name: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          observation_date?: string
          series_id?: string
          series_name?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          actor_tier: string | null
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          origin_account_id: string | null
          recipient_email: string
          sender_account: string | null
          status: string
          target_tier: string | null
          template_name: string
          tenant_id: string | null
        }
        Insert: {
          actor_tier?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          origin_account_id?: string | null
          recipient_email: string
          sender_account?: string | null
          status: string
          target_tier?: string | null
          template_name: string
          tenant_id?: string | null
        }
        Update: {
          actor_tier?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          origin_account_id?: string | null
          recipient_email?: string
          sender_account?: string | null
          status?: string
          target_tier?: string | null
          template_name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          active: boolean
          body_html: string | null
          body_markdown: string
          category: string
          created_at: string
          created_by_user_id: string | null
          notes: string | null
          preheader: string | null
          product_scope: string
          subject: string
          template_key: string
          tenant_id: string | null
          updated_at: string
          updated_by_user_id: string | null
          variables: Json
        }
        Insert: {
          active?: boolean
          body_html?: string | null
          body_markdown: string
          category: string
          created_at?: string
          created_by_user_id?: string | null
          notes?: string | null
          preheader?: string | null
          product_scope: string
          subject: string
          template_key: string
          tenant_id?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          variables?: Json
        }
        Update: {
          active?: boolean
          body_html?: string | null
          body_markdown?: string
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          notes?: string | null
          preheader?: string | null
          product_scope?: string
          subject?: string
          template_key?: string
          tenant_id?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string | null
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token?: string | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: []
      }
      extraction_quality_log: {
        Row: {
          account_count_original: number | null
          account_count_reextracted: number | null
          client_id: string | null
          created_at: string
          creditor_consistency_check: Json | null
          extraction_date: string
          id: string
          overall_quality_score: number | null
          quality_flags: Json | null
          report_id: string | null
          required_fields_percentage: number | null
          score_consistency_check: Json | null
          user_id: string
        }
        Insert: {
          account_count_original?: number | null
          account_count_reextracted?: number | null
          client_id?: string | null
          created_at?: string
          creditor_consistency_check?: Json | null
          extraction_date?: string
          id?: string
          overall_quality_score?: number | null
          quality_flags?: Json | null
          report_id?: string | null
          required_fields_percentage?: number | null
          score_consistency_check?: Json | null
          user_id: string
        }
        Update: {
          account_count_original?: number | null
          account_count_reextracted?: number | null
          client_id?: string | null
          created_at?: string
          creditor_consistency_check?: Json | null
          extraction_date?: string
          id?: string
          overall_quality_score?: number | null
          quality_flags?: Json | null
          report_id?: string | null
          required_fields_percentage?: number | null
          score_consistency_check?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_quality_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_quality_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "extraction_quality_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "extraction_quality_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_quality_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "credit_report_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_request_votes: {
        Row: {
          created_at: string
          feature_request_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_request_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feature_request_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_request_votes_feature_request_id_fkey"
            columns: ["feature_request_id"]
            isOneToOne: false
            referencedRelation: "feature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_requests: {
        Row: {
          admin_response: string | null
          category: string
          created_at: string
          description: string
          id: string
          planned_release: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          vote_count: number
        }
        Insert: {
          admin_response?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          planned_release?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          vote_count?: number
        }
        Update: {
          admin_response?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          planned_release?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          vote_count?: number
        }
        Relationships: []
      }
      financial_api_logs: {
        Row: {
          api_endpoint: string
          api_provider: string
          consent_event_id: string | null
          created_at: string
          id: string
          lenders_displayed: Json | null
          metadata: Json | null
          request_type: string
          response_status: number | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          api_endpoint: string
          api_provider: string
          consent_event_id?: string | null
          created_at?: string
          id?: string
          lenders_displayed?: Json | null
          metadata?: Json | null
          request_type: string
          response_status?: number | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          api_endpoint?: string
          api_provider?: string
          consent_event_id?: string | null
          created_at?: string
          id?: string
          lenders_displayed?: Json | null
          metadata?: Json | null
          request_type?: string
          response_status?: number | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_api_logs_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_document_analyses: {
        Row: {
          analysis_status: string
          avg_daily_balance: number | null
          avg_monthly_revenue: number | null
          business_id: string | null
          created_at: string
          doc_type_detected: string | null
          document_id: string
          error_message: string | null
          full_analysis: Json | null
          id: string
          largest_deposit: number | null
          largest_deposit_description: string | null
          largest_withdrawal: number | null
          largest_withdrawal_description: string | null
          lender_red_flags: Json | null
          lender_summary_path: string | null
          nsf_count: number | null
          overdraft_count: number | null
          period_end: string | null
          period_start: string | null
          revenue_trend: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_status?: string
          avg_daily_balance?: number | null
          avg_monthly_revenue?: number | null
          business_id?: string | null
          created_at?: string
          doc_type_detected?: string | null
          document_id: string
          error_message?: string | null
          full_analysis?: Json | null
          id?: string
          largest_deposit?: number | null
          largest_deposit_description?: string | null
          largest_withdrawal?: number | null
          largest_withdrawal_description?: string | null
          lender_red_flags?: Json | null
          lender_summary_path?: string | null
          nsf_count?: number | null
          overdraft_count?: number | null
          period_end?: string | null
          period_start?: string | null
          revenue_trend?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_status?: string
          avg_daily_balance?: number | null
          avg_monthly_revenue?: number | null
          business_id?: string | null
          created_at?: string
          doc_type_detected?: string | null
          document_id?: string
          error_message?: string | null
          full_analysis?: Json | null
          id?: string
          largest_deposit?: number | null
          largest_deposit_description?: string | null
          largest_withdrawal?: number | null
          largest_withdrawal_description?: string | null
          lender_red_flags?: Json | null
          lender_summary_path?: string | null
          nsf_count?: number | null
          overdraft_count?: number | null
          period_end?: string | null
          period_start?: string | null
          revenue_trend?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_document_analyses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_document_analyses_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_kpis: {
        Row: {
          avg_balance_30d: number | null
          avg_balance_90d: number | null
          created_at: string | null
          dscr: number | null
          id: string
          last_calculated_at: string | null
          monthly_inflow: number | null
          monthly_outflow: number | null
          nsf_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avg_balance_30d?: number | null
          avg_balance_90d?: number | null
          created_at?: string | null
          dscr?: number | null
          id?: string
          last_calculated_at?: string | null
          monthly_inflow?: number | null
          monthly_outflow?: number | null
          nsf_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avg_balance_30d?: number | null
          avg_balance_90d?: number | null
          created_at?: string | null
          dscr?: number | null
          id?: string
          last_calculated_at?: string | null
          monthly_inflow?: number | null
          monthly_outflow?: number | null
          nsf_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      funding_application_outcomes: {
        Row: {
          admin_notes: string | null
          amount_requested: number
          application_date: string
          approved_amount: number | null
          client_id: string | null
          created_at: string
          decline_reason: string | null
          decline_reason_other: string | null
          factor_rate: number | null
          follow_up_date: string | null
          id: string
          interest_rate: number | null
          lender_name: string
          outcome: string
          predicted_match_score: number | null
          product_type: string
          recorded_by: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount_requested: number
          application_date: string
          approved_amount?: number | null
          client_id?: string | null
          created_at?: string
          decline_reason?: string | null
          decline_reason_other?: string | null
          factor_rate?: number | null
          follow_up_date?: string | null
          id?: string
          interest_rate?: number | null
          lender_name: string
          outcome: string
          predicted_match_score?: number | null
          product_type: string
          recorded_by: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          amount_requested?: number
          application_date?: string
          approved_amount?: number | null
          client_id?: string | null
          created_at?: string
          decline_reason?: string | null
          decline_reason_other?: string | null
          factor_rate?: number | null
          follow_up_date?: string | null
          id?: string
          interest_rate?: number | null
          lender_name?: string
          outcome?: string
          predicted_match_score?: number | null
          product_type?: string
          recorded_by?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_application_outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_application_outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "funding_application_outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "funding_application_outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_application_sequence: {
        Row: {
          created_at: string | null
          estimated_amount: number | null
          id: string
          lender_product_id: string | null
          reason: string | null
          sequence_order: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          estimated_amount?: number | null
          id?: string
          lender_product_id?: string | null
          reason?: string | null
          sequence_order: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          estimated_amount?: number | null
          id?: string
          lender_product_id?: string | null
          reason?: string | null
          sequence_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_application_sequence_lender_product_id_fkey"
            columns: ["lender_product_id"]
            isOneToOne: false
            referencedRelation: "lender_products"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_applications: {
        Row: {
          amount_requested: number
          application_type: string
          business_id: string | null
          created_at: string | null
          funded_at: string | null
          id: string
          metadata: Json | null
          notes: string | null
          offer_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          status: string
          submitted_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_requested: number
          application_type: string
          business_id?: string | null
          created_at?: string | null
          funded_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          offer_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_requested?: number
          application_type?: string
          business_id?: string | null
          created_at?: string | null
          funded_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          offer_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_applications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_applications_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "funding_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_journey_applications: {
        Row: {
          amount_approved: number | null
          amount_requested: number | null
          application_date: string
          bureau_pulled: string | null
          business_id: string | null
          created_at: string
          credit_score_at_application: number | null
          decision_date: string | null
          denial_letter_url: string | null
          denial_reason_category:
            | Database["public"]["Enums"]["denial_reason_category"]
            | null
          denial_reason_detail: string | null
          id: string
          interest_rate: number | null
          lender_id: string | null
          lender_name: string
          next_steps: string | null
          notes: string | null
          product_category: string | null
          product_name: string | null
          status: Database["public"]["Enums"]["funding_journey_status"]
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_approved?: number | null
          amount_requested?: number | null
          application_date?: string
          bureau_pulled?: string | null
          business_id?: string | null
          created_at?: string
          credit_score_at_application?: number | null
          decision_date?: string | null
          denial_letter_url?: string | null
          denial_reason_category?:
            | Database["public"]["Enums"]["denial_reason_category"]
            | null
          denial_reason_detail?: string | null
          id?: string
          interest_rate?: number | null
          lender_id?: string | null
          lender_name: string
          next_steps?: string | null
          notes?: string | null
          product_category?: string | null
          product_name?: string | null
          status?: Database["public"]["Enums"]["funding_journey_status"]
          term_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_approved?: number | null
          amount_requested?: number | null
          application_date?: string
          bureau_pulled?: string | null
          business_id?: string | null
          created_at?: string
          credit_score_at_application?: number | null
          decision_date?: string | null
          denial_letter_url?: string | null
          denial_reason_category?:
            | Database["public"]["Enums"]["denial_reason_category"]
            | null
          denial_reason_detail?: string | null
          id?: string
          interest_rate?: number | null
          lender_id?: string | null
          lender_name?: string
          next_steps?: string | null
          notes?: string | null
          product_category?: string | null
          product_name?: string | null
          status?: Database["public"]["Enums"]["funding_journey_status"]
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_journey_applications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_matches: {
        Row: {
          ai_generated: boolean | null
          applied: boolean | null
          business_id: string | null
          client_id: string | null
          created_at: string | null
          dismissed: boolean | null
          id: string
          match_reasons: Json | null
          match_score: number | null
          match_type: string
          offer_id: string
          updated_at: string | null
          user_id: string
          viewed: boolean | null
        }
        Insert: {
          ai_generated?: boolean | null
          applied?: boolean | null
          business_id?: string | null
          client_id?: string | null
          created_at?: string | null
          dismissed?: boolean | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          match_type: string
          offer_id: string
          updated_at?: string | null
          user_id: string
          viewed?: boolean | null
        }
        Update: {
          ai_generated?: boolean | null
          applied?: boolean | null
          business_id?: string | null
          client_id?: string | null
          created_at?: string | null
          dismissed?: boolean | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          match_type?: string
          offer_id?: string
          updated_at?: string | null
          user_id?: string
          viewed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "funding_matches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "funding_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "funding_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_matches_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "funding_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_milestones: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          lender_name: string | null
          milestone_date: string
          milestone_type: Database["public"]["Enums"]["funding_milestone_type"]
          notes: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          lender_name?: string | null
          milestone_date?: string
          milestone_type: Database["public"]["Enums"]["funding_milestone_type"]
          notes?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          lender_name?: string | null
          milestone_date?: string
          milestone_type?: Database["public"]["Enums"]["funding_milestone_type"]
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      funding_offers: {
        Row: {
          accepted_naics_risk_categories:
            | Database["public"]["Enums"]["naics_risk_category"][]
            | null
          affiliate_tag: string | null
          apply_url: string
          approval_timeframe: string | null
          apr_range: string | null
          created_at: string | null
          funding_category: string | null
          funding_speed: string | null
          id: string
          industry_specialization: string[] | null
          is_active: boolean | null
          lender_type: string | null
          limits_range: string | null
          max_business_age_months: number | null
          max_credit_score: number | null
          max_revenue: number | null
          min_business_age_months: number | null
          min_credit_score: number | null
          min_revenue: number | null
          name: string
          product_type: string
          requirements: string | null
          requires_collateral: boolean | null
          specific_naics_codes: string[] | null
          updated_at: string | null
        }
        Insert: {
          accepted_naics_risk_categories?:
            | Database["public"]["Enums"]["naics_risk_category"][]
            | null
          affiliate_tag?: string | null
          apply_url: string
          approval_timeframe?: string | null
          apr_range?: string | null
          created_at?: string | null
          funding_category?: string | null
          funding_speed?: string | null
          id?: string
          industry_specialization?: string[] | null
          is_active?: boolean | null
          lender_type?: string | null
          limits_range?: string | null
          max_business_age_months?: number | null
          max_credit_score?: number | null
          max_revenue?: number | null
          min_business_age_months?: number | null
          min_credit_score?: number | null
          min_revenue?: number | null
          name: string
          product_type: string
          requirements?: string | null
          requires_collateral?: boolean | null
          specific_naics_codes?: string[] | null
          updated_at?: string | null
        }
        Update: {
          accepted_naics_risk_categories?:
            | Database["public"]["Enums"]["naics_risk_category"][]
            | null
          affiliate_tag?: string | null
          apply_url?: string
          approval_timeframe?: string | null
          apr_range?: string | null
          created_at?: string | null
          funding_category?: string | null
          funding_speed?: string | null
          id?: string
          industry_specialization?: string[] | null
          is_active?: boolean | null
          lender_type?: string | null
          limits_range?: string | null
          max_business_age_months?: number | null
          max_credit_score?: number | null
          max_revenue?: number | null
          min_business_age_months?: number | null
          min_credit_score?: number | null
          min_revenue?: number | null
          name?: string
          product_type?: string
          requirements?: string | null
          requires_collateral?: boolean | null
          specific_naics_codes?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      funding_plans: {
        Row: {
          business_id: string | null
          created_at: string | null
          current_tier: string | null
          id: string
          plan_steps: Json | null
          readiness_score: number | null
          status: string
          target_amount: number
          timeline: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          current_tier?: string | null
          id?: string
          plan_steps?: Json | null
          readiness_score?: number | null
          status?: string
          target_amount: number
          timeline?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          current_tier?: string | null
          id?: string
          plan_steps?: Json | null
          readiness_score?: number | null
          status?: string
          target_amount?: number
          timeline?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_plans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_projections: {
        Row: {
          calculated_at: string | null
          id: string
          new_products_unlocked: Json | null
          projected_matches: number | null
          projected_score: number | null
          projected_total_funding: number | null
          scenario_name: string
          scenario_params: Json
          user_id: string
        }
        Insert: {
          calculated_at?: string | null
          id?: string
          new_products_unlocked?: Json | null
          projected_matches?: number | null
          projected_score?: number | null
          projected_total_funding?: number | null
          scenario_name: string
          scenario_params?: Json
          user_id: string
        }
        Update: {
          calculated_at?: string | null
          id?: string
          new_products_unlocked?: Json | null
          projected_matches?: number | null
          projected_score?: number | null
          projected_total_funding?: number | null
          scenario_name?: string
          scenario_params?: Json
          user_id?: string
        }
        Relationships: []
      }
      funding_readiness_scores: {
        Row: {
          banking_history_score: number
          business_credit_score: number
          created_at: string
          entity_structure_score: number
          id: string
          last_calculated_at: string | null
          lender_alignment_score: number
          overall_score: number
          personal_credit_score: number
          revenue_documentation_score: number
          score_explanations: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          banking_history_score?: number
          business_credit_score?: number
          created_at?: string
          entity_structure_score?: number
          id?: string
          last_calculated_at?: string | null
          lender_alignment_score?: number
          overall_score?: number
          personal_credit_score?: number
          revenue_documentation_score?: number
          score_explanations?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          banking_history_score?: number
          business_credit_score?: number
          created_at?: string
          entity_structure_score?: number
          id?: string
          last_calculated_at?: string | null
          lender_alignment_score?: number
          overall_score?: number
          personal_credit_score?: number
          revenue_documentation_score?: number
          score_explanations?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      funding_secured: {
        Row: {
          amount: number
          client_user_id: string
          created_at: string
          date_secured: string
          factor_rate: number | null
          id: string
          interest_rate: number | null
          lender_name: string
          notes: string | null
          product_type: string
          term_length_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          client_user_id: string
          created_at?: string
          date_secured?: string
          factor_rate?: number | null
          id?: string
          interest_rate?: number | null
          lender_name: string
          notes?: string | null
          product_type: string
          term_length_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_user_id?: string
          created_at?: string
          date_secured?: string
          factor_rate?: number | null
          id?: string
          interest_rate?: number | null
          lender_name?: string
          notes?: string | null
          product_type?: string
          term_length_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      growth_automation_targets: {
        Row: {
          config_schema: Json
          description: string
          display_order: number
          enabled: boolean
          executor: string
          label: string
          slug: string
        }
        Insert: {
          config_schema?: Json
          description: string
          display_order?: number
          enabled?: boolean
          executor: string
          label: string
          slug: string
        }
        Update: {
          config_schema?: Json
          description?: string
          display_order?: number
          enabled?: boolean
          executor?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      growth_external_sources: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          field_map_json: Json
          id: string
          label: string
          last_seen_at: string | null
          provider: string
          target_form_id: string | null
          tenant_id: string
          updated_at: string
          webhook_token_ct: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          field_map_json?: Json
          id?: string
          label: string
          last_seen_at?: string | null
          provider: string
          target_form_id?: string | null
          tenant_id: string
          updated_at?: string
          webhook_token_ct?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          field_map_json?: Json
          id?: string
          label?: string
          last_seen_at?: string | null
          provider?: string
          target_form_id?: string | null
          tenant_id?: string
          updated_at?: string
          webhook_token_ct?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_external_sources_target_form_id_fkey"
            columns: ["target_form_id"]
            isOneToOne: false
            referencedRelation: "growth_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_external_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_form_automations: {
        Row: {
          autonomy_lane: string | null
          config_json: Json
          created_at: string | null
          created_by: string | null
          enabled: boolean
          form_id: string
          id: string
          order_index: number
          target_slug: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          autonomy_lane?: string | null
          config_json?: Json
          created_at?: string | null
          created_by?: string | null
          enabled?: boolean
          form_id: string
          id?: string
          order_index?: number
          target_slug: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          autonomy_lane?: string | null
          config_json?: Json
          created_at?: string | null
          created_by?: string | null
          enabled?: boolean
          form_id?: string
          id?: string
          order_index?: number
          target_slug?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_form_automations_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "growth_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_form_automations_target_slug_fkey"
            columns: ["target_slug"]
            isOneToOne: false
            referencedRelation: "growth_automation_targets"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "growth_form_automations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_form_submissions: {
        Row: {
          attempts: number
          claimed_at: string | null
          consent_json: Json
          contact_id: string | null
          created_at: string
          deal_id: string | null
          external_source_id: string | null
          form_id: string
          funnel_session_id: string | null
          id: string
          ip: string | null
          last_error: string | null
          payload_json: Json
          processed: boolean
          processed_at: string | null
          processing_state: string
          referrer: string | null
          source: string
          tenant_id: string
          user_agent: string | null
          utm_json: Json
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          consent_json?: Json
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_source_id?: string | null
          form_id: string
          funnel_session_id?: string | null
          id?: string
          ip?: string | null
          last_error?: string | null
          payload_json?: Json
          processed?: boolean
          processed_at?: string | null
          processing_state?: string
          referrer?: string | null
          source?: string
          tenant_id: string
          user_agent?: string | null
          utm_json?: Json
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          consent_json?: Json
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_source_id?: string | null
          form_id?: string
          funnel_session_id?: string | null
          id?: string
          ip?: string | null
          last_error?: string | null
          payload_json?: Json
          processed?: boolean
          processed_at?: string | null
          processing_state?: string
          referrer?: string | null
          source?: string
          tenant_id?: string
          user_agent?: string | null
          utm_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "growth_form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "growth_form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "growth_form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "growth_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_form_submissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_forms: {
        Row: {
          auto_create_contact: boolean
          auto_create_deal: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          notify_user_ids: string[]
          pipeline_id: string | null
          schema_json: Json
          slug: string
          stage_id: string | null
          status: string
          success_action_json: Json
          template_key: string | null
          tenant_id: string
          updated_at: string
          workflow_slug: string | null
        }
        Insert: {
          auto_create_contact?: boolean
          auto_create_deal?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notify_user_ids?: string[]
          pipeline_id?: string | null
          schema_json?: Json
          slug: string
          stage_id?: string | null
          status?: string
          success_action_json?: Json
          template_key?: string | null
          tenant_id: string
          updated_at?: string
          workflow_slug?: string | null
        }
        Update: {
          auto_create_contact?: boolean
          auto_create_deal?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notify_user_ids?: string[]
          pipeline_id?: string | null
          schema_json?: Json
          slug?: string
          stage_id?: string | null
          status?: string
          success_action_json?: Json
          template_key?: string | null
          tenant_id?: string
          updated_at?: string
          workflow_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_forms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_funnel_sessions: {
        Row: {
          completed: boolean
          created_at: string
          current_step: number
          funnel_id: string
          id: string
          referrer: string | null
          session_token: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
          utm_json: Json
        }
        Insert: {
          completed?: boolean
          created_at?: string
          current_step?: number
          funnel_id: string
          id?: string
          referrer?: string | null
          session_token: string
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
          utm_json?: Json
        }
        Update: {
          completed?: boolean
          created_at?: string
          current_step?: number
          funnel_id?: string
          id?: string
          referrer?: string | null
          session_token?: string
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
          utm_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "growth_funnel_sessions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "growth_funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnel_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_funnel_steps: {
        Row: {
          config_json: Json
          created_at: string
          form_id: string | null
          funnel_id: string
          id: string
          order_index: number
          page_id: string | null
          step_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config_json?: Json
          created_at?: string
          form_id?: string | null
          funnel_id: string
          id?: string
          order_index?: number
          page_id?: string | null
          step_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config_json?: Json
          created_at?: string
          form_id?: string | null
          funnel_id?: string
          id?: string
          order_index?: number
          page_id?: string | null
          step_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_funnel_steps_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "growth_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnel_steps_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "growth_funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnel_steps_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "growth_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnel_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_funnels: {
        Row: {
          created_at: string
          created_by: string | null
          entry_page_id: string | null
          goal: string | null
          id: string
          name: string
          slug: string
          status: string
          success_page_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_page_id?: string | null
          goal?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          success_page_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_page_id?: string | null
          goal?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          success_page_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_funnels_entry_page_id_fkey"
            columns: ["entry_page_id"]
            isOneToOne: false
            referencedRelation: "growth_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnels_success_page_id_fkey"
            columns: ["success_page_id"]
            isOneToOne: false
            referencedRelation: "growth_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_funnels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_pages: {
        Row: {
          blocks_json: Json
          created_at: string
          created_by: string | null
          draft_blocks_json: Json | null
          draft_seo_json: Json | null
          draft_theme_json: Json | null
          id: string
          og_image_url: string | null
          published_at: string | null
          seo_json: Json
          slug: string
          status: string
          template_key: string | null
          tenant_id: string
          theme_json: Json
          title: string
          updated_at: string
        }
        Insert: {
          blocks_json?: Json
          created_at?: string
          created_by?: string | null
          draft_blocks_json?: Json | null
          draft_seo_json?: Json | null
          draft_theme_json?: Json | null
          id?: string
          og_image_url?: string | null
          published_at?: string | null
          seo_json?: Json
          slug: string
          status?: string
          template_key?: string | null
          tenant_id: string
          theme_json?: Json
          title: string
          updated_at?: string
        }
        Update: {
          blocks_json?: Json
          created_at?: string
          created_by?: string | null
          draft_blocks_json?: Json | null
          draft_seo_json?: Json | null
          draft_theme_json?: Json | null
          id?: string
          og_image_url?: string | null
          published_at?: string | null
          seo_json?: Json
          slug?: string
          status?: string
          template_key?: string | null
          tenant_id?: string
          theme_json?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_submission_dispatches: {
        Row: {
          automation_id: string
          created_at: string
          error: string | null
          id: string
          result: Json
          status: string
          submission_id: string
          target_slug: string
          tenant_id: string
        }
        Insert: {
          automation_id: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json
          status?: string
          submission_id: string
          target_slug: string
          tenant_id: string
        }
        Update: {
          automation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json
          status?: string
          submission_id?: string
          target_slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_submission_dispatches_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "growth_form_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_submission_dispatches_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "growth_form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_submission_dispatches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_bookings: {
        Row: {
          appointment_type: Json | null
          booking_kind: string
          calendar_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          capacity: number | null
          class_session_id: string | null
          collective_group_id: string | null
          contact_id: string | null
          created_at: string
          end_at: string
          external_calendar_id: string | null
          external_event_id: string | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          host_user_id: string
          id: string
          intake_answers: Json | null
          location: string | null
          location_type: string | null
          location_value: string | null
          manage_token_version: number
          meeting_link: string | null
          meeting_url: string | null
          notes: string | null
          reminder_state: Json
          source: string
          start_at: string
          status: string
          tenant_id: string | null
          timezone: string
          title: string
          updated_at: string
          zoom_meeting_id: string | null
        }
        Insert: {
          appointment_type?: Json | null
          booking_kind?: string
          calendar_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          capacity?: number | null
          class_session_id?: string | null
          collective_group_id?: string | null
          contact_id?: string | null
          created_at?: string
          end_at: string
          external_calendar_id?: string | null
          external_event_id?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          host_user_id: string
          id?: string
          intake_answers?: Json | null
          location?: string | null
          location_type?: string | null
          location_value?: string | null
          manage_token_version?: number
          meeting_link?: string | null
          meeting_url?: string | null
          notes?: string | null
          reminder_state?: Json
          source?: string
          start_at: string
          status?: string
          tenant_id?: string | null
          timezone?: string
          title: string
          updated_at?: string
          zoom_meeting_id?: string | null
        }
        Update: {
          appointment_type?: Json | null
          booking_kind?: string
          calendar_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          capacity?: number | null
          class_session_id?: string | null
          collective_group_id?: string | null
          contact_id?: string | null
          created_at?: string
          end_at?: string
          external_calendar_id?: string | null
          external_event_id?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          host_user_id?: string
          id?: string
          intake_answers?: Json | null
          location?: string | null
          location_type?: string | null
          location_value?: string | null
          manage_token_version?: number
          meeting_link?: string | null
          meeting_url?: string | null
          notes?: string | null
          reminder_state?: Json
          source?: string
          start_at?: string
          status?: string
          tenant_id?: string | null
          timezone?: string
          title?: string
          updated_at?: string
          zoom_meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_bookings_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_bookings_class_session_id_fkey"
            columns: ["class_session_id"]
            isOneToOne: false
            referencedRelation: "internal_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "internal_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "internal_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          actor_tier: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          metadata: Json
          origin_account_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_tier: string | null
          template_name: string | null
          tenant_id: string | null
          token: string | null
          token_hash: string | null
        }
        Insert: {
          accepted_at?: string | null
          actor_tier?: string | null
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          metadata?: Json
          origin_account_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_tier?: string | null
          template_name?: string | null
          tenant_id?: string | null
          token?: string | null
          token_hash?: string | null
        }
        Update: {
          accepted_at?: string | null
          actor_tier?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          metadata?: Json
          origin_account_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_tier?: string | null
          template_name?: string | null
          tenant_id?: string | null
          token?: string | null
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_coverage_signal: {
        Row: {
          date: string
          doc_count: number
          id: string
          query_count: number
          tenant_id: string | null
          topic_cluster: string
          unanswered_count: number
        }
        Insert: {
          date?: string
          doc_count?: number
          id?: string
          query_count?: number
          tenant_id?: string | null
          topic_cluster: string
          unanswered_count?: number
        }
        Update: {
          date?: string
          doc_count?: number
          id?: string
          query_count?: number
          tenant_id?: string | null
          topic_cluster?: string
          unanswered_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "kb_coverage_signal_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_query_telemetry: {
        Row: {
          created_at: string
          feedback: string | null
          had_global_match: boolean
          had_tenant_match: boolean
          id: string
          query_hash: string
          query_intent_tags: string[] | null
          query_length: number | null
          result_count: number
          tenant_id: string | null
          top_similarity: number | null
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          had_global_match?: boolean
          had_tenant_match?: boolean
          id?: string
          query_hash: string
          query_intent_tags?: string[] | null
          query_length?: number | null
          result_count?: number
          tenant_id?: string | null
          top_similarity?: number | null
        }
        Update: {
          created_at?: string
          feedback?: string | null
          had_global_match?: boolean
          had_tenant_match?: boolean
          id?: string
          query_hash?: string
          query_intent_tags?: string[] | null
          query_length?: number | null
          result_count?: number
          tenant_id?: string | null
          top_similarity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_query_telemetry_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: Database["public"]["Enums"]["knowledge_category"]
          content: string
          created_at: string | null
          framework: string
          id: string
          metadata: Json | null
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["knowledge_category"]
          content: string
          created_at?: string | null
          framework: string
          id?: string
          metadata?: Json | null
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["knowledge_category"]
          content?: string
          created_at?: string | null
          framework?: string
          id?: string
          metadata?: Json | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          context: Json
          created_at: string
          document_id: string | null
          document_slug: string
          document_version: number
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          context?: Json
          created_at?: string
          document_id?: string | null
          document_slug: string
          document_version: number
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          context?: Json
          created_at?: string
          document_id?: string | null
          document_slug?: string
          document_version?: number
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          audience: string
          body_md: string
          created_at: string
          created_by: string | null
          effective_date: string
          id: string
          is_current: boolean
          required_at_signup: boolean
          slug: string
          summary: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          audience?: string
          body_md: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          id?: string
          is_current?: boolean
          required_at_signup?: boolean
          slug: string
          summary?: string | null
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          audience?: string
          body_md?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          id?: string
          is_current?: boolean
          required_at_signup?: boolean
          slug?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lender_bureau_preferences: {
        Row: {
          application_url: string | null
          business_credit_bureaus: string[] | null
          confidence_level: string
          confidence_source: string
          created_at: string
          fdic_cert: string | null
          funding_speed: string | null
          geographic_scope: string
          id: string
          institution_name: string
          institution_type: string
          interest_rate_range: string | null
          is_active: boolean | null
          is_sba_approved: boolean | null
          max_loan_amount: number | null
          min_annual_revenue: number | null
          min_credit_score: number | null
          min_loan_amount: number | null
          min_time_in_business_months: number | null
          ncua_charter: string | null
          notes: string | null
          personal_credit_impact: string | null
          primary_bureau: string
          product_category: string | null
          product_subcategory: string | null
          requires_collateral: boolean | null
          requires_personal_guarantee: boolean | null
          sba_preferred_lender: boolean | null
          secondary_bureau: string | null
          serves_bad_credit: boolean | null
          serves_minority_owned: boolean | null
          serves_startups: boolean | null
          serves_veterans: boolean | null
          serves_women_owned: boolean | null
          states_applicable: string[] | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          application_url?: string | null
          business_credit_bureaus?: string[] | null
          confidence_level?: string
          confidence_source?: string
          created_at?: string
          fdic_cert?: string | null
          funding_speed?: string | null
          geographic_scope?: string
          id?: string
          institution_name: string
          institution_type?: string
          interest_rate_range?: string | null
          is_active?: boolean | null
          is_sba_approved?: boolean | null
          max_loan_amount?: number | null
          min_annual_revenue?: number | null
          min_credit_score?: number | null
          min_loan_amount?: number | null
          min_time_in_business_months?: number | null
          ncua_charter?: string | null
          notes?: string | null
          personal_credit_impact?: string | null
          primary_bureau?: string
          product_category?: string | null
          product_subcategory?: string | null
          requires_collateral?: boolean | null
          requires_personal_guarantee?: boolean | null
          sba_preferred_lender?: boolean | null
          secondary_bureau?: string | null
          serves_bad_credit?: boolean | null
          serves_minority_owned?: boolean | null
          serves_startups?: boolean | null
          serves_veterans?: boolean | null
          serves_women_owned?: boolean | null
          states_applicable?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          application_url?: string | null
          business_credit_bureaus?: string[] | null
          confidence_level?: string
          confidence_source?: string
          created_at?: string
          fdic_cert?: string | null
          funding_speed?: string | null
          geographic_scope?: string
          id?: string
          institution_name?: string
          institution_type?: string
          interest_rate_range?: string | null
          is_active?: boolean | null
          is_sba_approved?: boolean | null
          max_loan_amount?: number | null
          min_annual_revenue?: number | null
          min_credit_score?: number | null
          min_loan_amount?: number | null
          min_time_in_business_months?: number | null
          ncua_charter?: string | null
          notes?: string | null
          personal_credit_impact?: string | null
          primary_bureau?: string
          product_category?: string | null
          product_subcategory?: string | null
          requires_collateral?: boolean | null
          requires_personal_guarantee?: boolean | null
          sba_preferred_lender?: boolean | null
          secondary_bureau?: string | null
          serves_bad_credit?: boolean | null
          serves_minority_owned?: boolean | null
          serves_startups?: boolean | null
          serves_veterans?: boolean | null
          serves_women_owned?: boolean | null
          states_applicable?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      lender_products: {
        Row: {
          affiliate_commission_pct: number | null
          affiliate_url: string | null
          application_url: string | null
          apr_range_high: number | null
          apr_range_low: number | null
          business_credit_bureaus: string[] | null
          confidence_level: string | null
          created_at: string | null
          ein_only: boolean | null
          funding_speed: string | null
          id: string
          interest_rate_range: string | null
          is_active: boolean | null
          is_sba_approved: boolean | null
          last_verified: string | null
          lender_name: string
          max_amount: number | null
          max_derogatory_items: number | null
          max_inquiries_12mo: number | null
          max_inquiries_6mo: number | null
          max_utilization_pct: number | null
          min_account_age_months: number | null
          min_amount: number | null
          min_annual_revenue: number | null
          min_build_phase_business: string | null
          min_build_phase_personal: string | null
          min_business_age_months: number | null
          min_dscr: number | null
          min_fico_score: number | null
          min_intelliscore: number | null
          min_months_clean_reporting: number | null
          min_open_accounts: number | null
          min_paydex: number | null
          notes: string | null
          personal_credit_impact: string | null
          primary_bureau: string | null
          product_category: string | null
          product_name: string
          product_subcategory: string | null
          product_type: string
          requires_collateral: boolean | null
          requires_duns: boolean
          requires_personal_guarantee: boolean | null
          requires_pg: boolean | null
          sba_preferred_lender: boolean | null
          secondary_bureau: string | null
          serves_bad_credit: boolean | null
          serves_minority_owned: boolean | null
          serves_startups: boolean | null
          serves_veterans: boolean | null
          serves_women_owned: boolean | null
          term_months: number | null
          updated_at: string | null
        }
        Insert: {
          affiliate_commission_pct?: number | null
          affiliate_url?: string | null
          application_url?: string | null
          apr_range_high?: number | null
          apr_range_low?: number | null
          business_credit_bureaus?: string[] | null
          confidence_level?: string | null
          created_at?: string | null
          ein_only?: boolean | null
          funding_speed?: string | null
          id?: string
          interest_rate_range?: string | null
          is_active?: boolean | null
          is_sba_approved?: boolean | null
          last_verified?: string | null
          lender_name: string
          max_amount?: number | null
          max_derogatory_items?: number | null
          max_inquiries_12mo?: number | null
          max_inquiries_6mo?: number | null
          max_utilization_pct?: number | null
          min_account_age_months?: number | null
          min_amount?: number | null
          min_annual_revenue?: number | null
          min_build_phase_business?: string | null
          min_build_phase_personal?: string | null
          min_business_age_months?: number | null
          min_dscr?: number | null
          min_fico_score?: number | null
          min_intelliscore?: number | null
          min_months_clean_reporting?: number | null
          min_open_accounts?: number | null
          min_paydex?: number | null
          notes?: string | null
          personal_credit_impact?: string | null
          primary_bureau?: string | null
          product_category?: string | null
          product_name: string
          product_subcategory?: string | null
          product_type: string
          requires_collateral?: boolean | null
          requires_duns?: boolean
          requires_personal_guarantee?: boolean | null
          requires_pg?: boolean | null
          sba_preferred_lender?: boolean | null
          secondary_bureau?: string | null
          serves_bad_credit?: boolean | null
          serves_minority_owned?: boolean | null
          serves_startups?: boolean | null
          serves_veterans?: boolean | null
          serves_women_owned?: boolean | null
          term_months?: number | null
          updated_at?: string | null
        }
        Update: {
          affiliate_commission_pct?: number | null
          affiliate_url?: string | null
          application_url?: string | null
          apr_range_high?: number | null
          apr_range_low?: number | null
          business_credit_bureaus?: string[] | null
          confidence_level?: string | null
          created_at?: string | null
          ein_only?: boolean | null
          funding_speed?: string | null
          id?: string
          interest_rate_range?: string | null
          is_active?: boolean | null
          is_sba_approved?: boolean | null
          last_verified?: string | null
          lender_name?: string
          max_amount?: number | null
          max_derogatory_items?: number | null
          max_inquiries_12mo?: number | null
          max_inquiries_6mo?: number | null
          max_utilization_pct?: number | null
          min_account_age_months?: number | null
          min_amount?: number | null
          min_annual_revenue?: number | null
          min_build_phase_business?: string | null
          min_build_phase_personal?: string | null
          min_business_age_months?: number | null
          min_dscr?: number | null
          min_fico_score?: number | null
          min_intelliscore?: number | null
          min_months_clean_reporting?: number | null
          min_open_accounts?: number | null
          min_paydex?: number | null
          notes?: string | null
          personal_credit_impact?: string | null
          primary_bureau?: string | null
          product_category?: string | null
          product_name?: string
          product_subcategory?: string | null
          product_type?: string
          requires_collateral?: boolean | null
          requires_duns?: boolean
          requires_personal_guarantee?: boolean | null
          requires_pg?: boolean | null
          sba_preferred_lender?: boolean | null
          secondary_bureau?: string | null
          serves_bad_credit?: boolean | null
          serves_minority_owned?: boolean | null
          serves_startups?: boolean | null
          serves_veterans?: boolean | null
          serves_women_owned?: boolean | null
          term_months?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      lender_research_results: {
        Row: {
          client_user_id: string | null
          created_at: string
          id: string
          is_deep_research: boolean
          market_commentary: string | null
          provenance: string
          results: Json
          search_criteria: Json
          search_status: string
          sources: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          client_user_id?: string | null
          created_at?: string
          id?: string
          is_deep_research?: boolean
          market_commentary?: string | null
          provenance?: string
          results?: Json
          search_criteria?: Json
          search_status?: string
          sources?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          client_user_id?: string | null
          created_at?: string
          id?: string
          is_deep_research?: boolean
          market_commentary?: string | null
          provenance?: string
          results?: Json
          search_criteria?: Json
          search_status?: string
          sources?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          content_markdown: string | null
          content_type: string | null
          content_url: string | null
          course_id: string
          created_at: string | null
          duration_minutes: number | null
          id: string
          is_required: boolean | null
          module_number: number
          sort_order: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          content_markdown?: string | null
          content_type?: string | null
          content_url?: string | null
          course_id: string
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          is_required?: boolean | null
          module_number: number
          sort_order?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          content_markdown?: string | null
          content_type?: string | null
          content_url?: string | null
          course_id?: string
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          is_required?: boolean | null
          module_number?: number
          sort_order?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_banking_entries: {
        Row: {
          accounts_separated: boolean | null
          avg_daily_balance: number | null
          avg_monthly_revenue: number | null
          created_at: string
          id: string
          monthly_nsf_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accounts_separated?: boolean | null
          avg_daily_balance?: number | null
          avg_monthly_revenue?: number | null
          created_at?: string
          id?: string
          monthly_nsf_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accounts_separated?: boolean | null
          avg_daily_balance?: number | null
          avg_monthly_revenue?: number | null
          created_at?: string
          id?: string
          monthly_nsf_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketing_content: {
        Row: {
          body: string | null
          brief: string | null
          channel: string | null
          created_at: string
          created_by: string | null
          id: string
          image_path: string | null
          image_url: string | null
          kind: string
          meta: Json
          size: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          brief?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          kind?: string
          meta?: Json
          size?: string | null
          status?: string
          tenant_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          brief?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          kind?: string
          meta?: Json
          size?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_content_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_install_bundle_links: {
        Row: {
          bundle_install_id: string
          child_install_id: string
          child_item_slug: string
          linked_at: string
          tenant_id: string
        }
        Insert: {
          bundle_install_id: string
          child_install_id: string
          child_item_slug: string
          linked_at?: string
          tenant_id: string
        }
        Update: {
          bundle_install_id?: string
          child_install_id?: string
          child_item_slug?: string
          linked_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_install_bundle_links_bundle_install_id_fkey"
            columns: ["bundle_install_id"]
            isOneToOne: false
            referencedRelation: "marketplace_installs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_install_bundle_links_child_install_id_fkey"
            columns: ["child_install_id"]
            isOneToOne: false
            referencedRelation: "marketplace_installs"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_install_ledger: {
        Row: {
          event_type: string
          gross_cents: number
          id: string
          install_id: string | null
          item_id: string
          occurred_at: string
          platform_fee_cents: number
          stripe_ref: string | null
          take_rate_bps: number
          tenant_id: string
          vendor_id: string
          vendor_net_cents: number
        }
        Insert: {
          event_type: string
          gross_cents?: number
          id?: string
          install_id?: string | null
          item_id: string
          occurred_at?: string
          platform_fee_cents?: number
          stripe_ref?: string | null
          take_rate_bps?: number
          tenant_id: string
          vendor_id: string
          vendor_net_cents?: number
        }
        Update: {
          event_type?: string
          gross_cents?: number
          id?: string
          install_id?: string | null
          item_id?: string
          occurred_at?: string
          platform_fee_cents?: number
          stripe_ref?: string | null
          take_rate_bps?: number
          tenant_id?: string
          vendor_id?: string
          vendor_net_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_install_ledger_install_id_fkey"
            columns: ["install_id"]
            isOneToOne: false
            referencedRelation: "marketplace_installs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_install_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "marketplace_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_install_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_install_ledger_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "marketplace_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_installs: {
        Row: {
          held_directly: boolean
          id: string
          installed_at: string
          installed_by: string | null
          installed_by_agent: string | null
          item_id: string
          seeded_refs: Json
          service_subscription_id: string | null
          status: string
          tenant_id: string
          uninstalled_at: string | null
          version_id: string
        }
        Insert: {
          held_directly?: boolean
          id?: string
          installed_at?: string
          installed_by?: string | null
          installed_by_agent?: string | null
          item_id: string
          seeded_refs?: Json
          service_subscription_id?: string | null
          status?: string
          tenant_id: string
          uninstalled_at?: string | null
          version_id: string
        }
        Update: {
          held_directly?: boolean
          id?: string
          installed_at?: string
          installed_by?: string | null
          installed_by_agent?: string | null
          item_id?: string
          seeded_refs?: Json
          service_subscription_id?: string | null
          status?: string
          tenant_id?: string
          uninstalled_at?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_installs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "marketplace_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_installs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_installs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "marketplace_item_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_item_versions: {
        Row: {
          approved_at: string | null
          changelog: string | null
          code_ref: Json | null
          created_at: string
          created_by: string | null
          deprecated_at: string | null
          id: string
          install_manifest: Json
          item_id: string
          payload_class: Database["public"]["Enums"]["marketplace_payload_class"]
          published_at: string | null
          review_proposal_id: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          semver: string
          status: Database["public"]["Enums"]["marketplace_version_status"]
          submitted_at: string | null
        }
        Insert: {
          approved_at?: string | null
          changelog?: string | null
          code_ref?: Json | null
          created_at?: string
          created_by?: string | null
          deprecated_at?: string | null
          id?: string
          install_manifest?: Json
          item_id: string
          payload_class?: Database["public"]["Enums"]["marketplace_payload_class"]
          published_at?: string | null
          review_proposal_id?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          semver: string
          status?: Database["public"]["Enums"]["marketplace_version_status"]
          submitted_at?: string | null
        }
        Update: {
          approved_at?: string | null
          changelog?: string | null
          code_ref?: Json | null
          created_at?: string
          created_by?: string | null
          deprecated_at?: string | null
          id?: string
          install_manifest?: Json
          item_id?: string
          payload_class?: Database["public"]["Enums"]["marketplace_payload_class"]
          published_at?: string | null
          review_proposal_id?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          semver?: string
          status?: Database["public"]["Enums"]["marketplace_version_status"]
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_item_versions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "marketplace_items"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_items: {
        Row: {
          available_to_tiers: Json
          billing_period: string | null
          category: string
          created_at: string
          current_version_id: string | null
          default_for_new_tenants: boolean
          description: string | null
          featured: boolean
          icon: string | null
          id: string
          install_count: number
          installable_by_role: Json
          is_finance: boolean
          item_type: Database["public"]["Enums"]["marketplace_item_type"]
          metadata: Json
          name: string
          origin: Database["public"]["Enums"]["marketplace_origin"]
          price_cents: number
          pricing_model: string
          publish_status: string
          publisher_tenant_id: string | null
          rating_avg: number | null
          rating_count: number
          scope: Database["public"]["Enums"]["marketplace_scope"]
          serves: string
          slug: string
          source_type: string
          status: Database["public"]["Enums"]["marketplace_item_status"]
          tagline: string | null
          take_rate_bps: number
          updated_at: string
          vendor_id: string
          visible_to_agency_id: string | null
          visible_to_tenant_id: string | null
        }
        Insert: {
          available_to_tiers?: Json
          billing_period?: string | null
          category: string
          created_at?: string
          current_version_id?: string | null
          default_for_new_tenants?: boolean
          description?: string | null
          featured?: boolean
          icon?: string | null
          id?: string
          install_count?: number
          installable_by_role?: Json
          is_finance?: boolean
          item_type: Database["public"]["Enums"]["marketplace_item_type"]
          metadata?: Json
          name: string
          origin: Database["public"]["Enums"]["marketplace_origin"]
          price_cents?: number
          pricing_model?: string
          publish_status?: string
          publisher_tenant_id?: string | null
          rating_avg?: number | null
          rating_count?: number
          scope?: Database["public"]["Enums"]["marketplace_scope"]
          serves?: string
          slug: string
          source_type?: string
          status?: Database["public"]["Enums"]["marketplace_item_status"]
          tagline?: string | null
          take_rate_bps?: number
          updated_at?: string
          vendor_id: string
          visible_to_agency_id?: string | null
          visible_to_tenant_id?: string | null
        }
        Update: {
          available_to_tiers?: Json
          billing_period?: string | null
          category?: string
          created_at?: string
          current_version_id?: string | null
          default_for_new_tenants?: boolean
          description?: string | null
          featured?: boolean
          icon?: string | null
          id?: string
          install_count?: number
          installable_by_role?: Json
          is_finance?: boolean
          item_type?: Database["public"]["Enums"]["marketplace_item_type"]
          metadata?: Json
          name?: string
          origin?: Database["public"]["Enums"]["marketplace_origin"]
          price_cents?: number
          pricing_model?: string
          publish_status?: string
          publisher_tenant_id?: string | null
          rating_avg?: number | null
          rating_count?: number
          scope?: Database["public"]["Enums"]["marketplace_scope"]
          serves?: string
          slug?: string
          source_type?: string
          status?: Database["public"]["Enums"]["marketplace_item_status"]
          tagline?: string | null
          take_rate_bps?: number
          updated_at?: string
          vendor_id?: string
          visible_to_agency_id?: string | null
          visible_to_tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_items_publisher_tenant_id_fkey"
            columns: ["publisher_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "marketplace_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_items_visible_to_agency_id_fkey"
            columns: ["visible_to_agency_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_items_visible_to_tenant_id_fkey"
            columns: ["visible_to_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_items_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "marketplace_item_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_vendors: {
        Row: {
          contact_email: string | null
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          metadata: Json
          origin: Database["public"]["Enums"]["marketplace_origin"]
          owner_tenant_id: string | null
          payout_status: string
          slug: string
          status: string
          stripe_connect_account_id: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          metadata?: Json
          origin?: Database["public"]["Enums"]["marketplace_origin"]
          owner_tenant_id?: string | null
          payout_status?: string
          slug: string
          status?: string
          stripe_connect_account_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          metadata?: Json
          origin?: Database["public"]["Enums"]["marketplace_origin"]
          owner_tenant_id?: string | null
          payout_status?: string
          slug?: string
          status?: string
          stripe_connect_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_vendors_owner_tenant_id_fkey"
            columns: ["owner_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      naics_codes: {
        Row: {
          created_at: string | null
          description: string | null
          funding_notes: string | null
          id: string
          industry_title: string
          naics_code: string
          risk_category: Database["public"]["Enums"]["naics_risk_category"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          funding_notes?: string | null
          id?: string
          industry_title: string
          naics_code: string
          risk_category?: Database["public"]["Enums"]["naics_risk_category"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          funding_notes?: string | null
          id?: string
          industry_title?: string
          naics_code?: string
          risk_category?: Database["public"]["Enums"]["naics_risk_category"]
          updated_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          alert_type: string
          channel: string
          created_at: string | null
          enabled: boolean | null
          id: string
          metadata: Json | null
          threshold_operator: string | null
          threshold_value: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          alert_type: string
          channel: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          metadata?: Json | null
          threshold_operator?: string | null
          threshold_value?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          alert_type?: string
          channel?: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          metadata?: Json | null
          threshold_operator?: string | null
          threshold_value?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          id: string
          plan_type: string
          status: Database["public"]["Enums"]["order_status"]
          stripe_session_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          id?: string
          plan_type: string
          status?: Database["public"]["Enums"]["order_status"]
          stripe_session_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          id?: string
          plan_type?: string
          status?: Database["public"]["Enums"]["order_status"]
          stripe_session_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      outbound_webhook_configs: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          label: string
          subscribed_events: string[]
          updated_at: string
          url_ct: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          label: string
          subscribed_events?: string[]
          updated_at?: string
          url_ct?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          label?: string
          subscribed_events?: string[]
          updated_at?: string
          url_ct?: string | null
        }
        Relationships: []
      }
      outreach_drafts: {
        Row: {
          admin_edited: boolean
          client_user_id: string
          compliance_flag_count: number
          compliance_flags: Json | null
          compliance_status: string
          created_at: string
          created_by: string
          downloaded_at: string | null
          edited_content: string | null
          funding_product: string | null
          generated_content: string
          id: string
          lender_name: string | null
          metadata: Json | null
          outreach_type: string
          updated_at: string
        }
        Insert: {
          admin_edited?: boolean
          client_user_id: string
          compliance_flag_count?: number
          compliance_flags?: Json | null
          compliance_status?: string
          created_at?: string
          created_by: string
          downloaded_at?: string | null
          edited_content?: string | null
          funding_product?: string | null
          generated_content: string
          id?: string
          lender_name?: string | null
          metadata?: Json | null
          outreach_type: string
          updated_at?: string
        }
        Update: {
          admin_edited?: boolean
          client_user_id?: string
          compliance_flag_count?: number
          compliance_flags?: Json | null
          compliance_status?: string
          created_at?: string
          created_by?: string
          downloaded_at?: string | null
          edited_content?: string | null
          funding_product?: string | null
          generated_content?: string
          id?: string
          lender_name?: string | null
          metadata?: Json | null
          outreach_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      paige_action_kinds: {
        Row: {
          approval_type: string
          created_at: string
          default_autonomy_lane: string
          default_from_department: string
          default_priority: string
          default_to_department: string
          description: string
          draft_subagent_slug: string | null
          enabled: boolean
          executor: string
          label: string
          requires_approval: boolean
          slug: string
          tenant_id: string | null
        }
        Insert: {
          approval_type?: string
          created_at?: string
          default_autonomy_lane?: string
          default_from_department: string
          default_priority?: string
          default_to_department: string
          description: string
          draft_subagent_slug?: string | null
          enabled?: boolean
          executor: string
          label: string
          requires_approval?: boolean
          slug: string
          tenant_id?: string | null
        }
        Update: {
          approval_type?: string
          created_at?: string
          default_autonomy_lane?: string
          default_from_department?: string
          default_priority?: string
          default_to_department?: string
          description?: string
          draft_subagent_slug?: string | null
          enabled?: boolean
          executor?: string
          label?: string
          requires_approval?: boolean
          slug?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_action_kinds_default_from_department_fkey"
            columns: ["default_from_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_action_kinds_default_to_department_fkey"
            columns: ["default_to_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_action_kinds_draft_subagent_slug_fkey"
            columns: ["draft_subagent_slug"]
            isOneToOne: false
            referencedRelation: "paige_subagents"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_action_kinds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_actions: {
        Row: {
          action_kind: string
          actor_tier: string | null
          approval_id: string | null
          assigned_at: string | null
          assigned_subagent_slug: string | null
          assigned_to_user_id: string | null
          autonomy_lane: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          customer_action_id: string | null
          decision_rationale: string | null
          draft_content: Json | null
          drafted_at: string | null
          due_at: string | null
          error: string | null
          executed_at: string | null
          expires_at: string | null
          filed_at: string
          from_department: string
          id: string
          invocation_id: string | null
          origin_account_id: string | null
          parent_action_id: string | null
          payload: Json
          priority: string
          resolved_at: string | null
          result: Json | null
          status: string
          summary: string | null
          target_tier: string | null
          tenant_id: string
          title: string
          to_department: string
          updated_at: string
          workflow_run_id: string | null
        }
        Insert: {
          action_kind: string
          actor_tier?: string | null
          approval_id?: string | null
          assigned_at?: string | null
          assigned_subagent_slug?: string | null
          assigned_to_user_id?: string | null
          autonomy_lane?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          customer_action_id?: string | null
          decision_rationale?: string | null
          draft_content?: Json | null
          drafted_at?: string | null
          due_at?: string | null
          error?: string | null
          executed_at?: string | null
          expires_at?: string | null
          filed_at?: string
          from_department: string
          id?: string
          invocation_id?: string | null
          origin_account_id?: string | null
          parent_action_id?: string | null
          payload?: Json
          priority?: string
          resolved_at?: string | null
          result?: Json | null
          status?: string
          summary?: string | null
          target_tier?: string | null
          tenant_id: string
          title: string
          to_department: string
          updated_at?: string
          workflow_run_id?: string | null
        }
        Update: {
          action_kind?: string
          actor_tier?: string | null
          approval_id?: string | null
          assigned_at?: string | null
          assigned_subagent_slug?: string | null
          assigned_to_user_id?: string | null
          autonomy_lane?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          customer_action_id?: string | null
          decision_rationale?: string | null
          draft_content?: Json | null
          drafted_at?: string | null
          due_at?: string | null
          error?: string | null
          executed_at?: string | null
          expires_at?: string | null
          filed_at?: string
          from_department?: string
          id?: string
          invocation_id?: string | null
          origin_account_id?: string | null
          parent_action_id?: string | null
          payload?: Json
          priority?: string
          resolved_at?: string | null
          result?: Json | null
          status?: string
          summary?: string | null
          target_tier?: string | null
          tenant_id?: string
          title?: string
          to_department?: string
          updated_at?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_actions_action_kind_fkey"
            columns: ["action_kind"]
            isOneToOne: false
            referencedRelation: "paige_action_kinds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_actions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_approval_queue_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_assigned_subagent_slug_fkey"
            columns: ["assigned_subagent_slug"]
            isOneToOne: false
            referencedRelation: "paige_subagents"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "paige_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_customer_action_id_fkey"
            columns: ["customer_action_id"]
            isOneToOne: false
            referencedRelation: "paige_customer_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_from_department_fkey"
            columns: ["from_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_actions_invocation_id_fkey"
            columns: ["invocation_id"]
            isOneToOne: false
            referencedRelation: "paige_subagent_invocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_parent_action_id_fkey"
            columns: ["parent_action_id"]
            isOneToOne: false
            referencedRelation: "paige_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_actions_to_department_fkey"
            columns: ["to_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_actions_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "paige_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_admin_notifications: {
        Row: {
          assigned_role: string | null
          assigned_user_id: string | null
          body: string | null
          contact_id: string | null
          created_at: string
          id: string
          link_to: string | null
          read_at: string | null
          scope: string
          severity: string
          source_workflow_key: string | null
          title: string
        }
        Insert: {
          assigned_role?: string | null
          assigned_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          link_to?: string | null
          read_at?: string | null
          scope?: string
          severity?: string
          source_workflow_key?: string | null
          title: string
        }
        Update: {
          assigned_role?: string | null
          assigned_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          link_to?: string | null
          read_at?: string | null
          scope?: string
          severity?: string
          source_workflow_key?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_admin_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_admin_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_admin_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_admin_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_alert_firing: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          delivered_at: string | null
          delivery_error: string | null
          delivery_status: string
          fired_at: string
          id: string
          metadata: Json
          observed: Json
          rule_id: string
          scope_tenant_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string
          fired_at?: string
          id?: string
          metadata?: Json
          observed?: Json
          rule_id: string
          scope_tenant_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?: string
          fired_at?: string
          id?: string
          metadata?: Json
          observed?: Json
          rule_id?: string
          scope_tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_alert_firing_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "paige_alert_rule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_alert_firing_scope_tenant_id_fkey"
            columns: ["scope_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_alert_rule: {
        Row: {
          autonomy_lane: string
          channels: Json
          condition: Json
          condition_met_since: string | null
          created_at: string
          created_by: string | null
          department: string | null
          description: string | null
          id: string
          is_active: boolean
          last_evaluated_at: string | null
          last_fired_at: string | null
          name: string
          severity: string
          updated_at: string
        }
        Insert: {
          autonomy_lane?: string
          channels?: Json
          condition: Json
          condition_met_since?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_evaluated_at?: string | null
          last_fired_at?: string | null
          name: string
          severity?: string
          updated_at?: string
        }
        Update: {
          autonomy_lane?: string
          channels?: Json
          condition?: Json
          condition_met_since?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_evaluated_at?: string | null
          last_fired_at?: string | null
          name?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      paige_alert_signal: {
        Row: {
          created_at: string
          description: string
          is_readable: boolean
          key: string
          label: string
          notes: string | null
          reader: string | null
          value_kind: string
        }
        Insert: {
          created_at?: string
          description: string
          is_readable?: boolean
          key: string
          label: string
          notes?: string | null
          reader?: string | null
          value_kind: string
        }
        Update: {
          created_at?: string
          description?: string
          is_readable?: boolean
          key?: string
          label?: string
          notes?: string | null
          reader?: string | null
          value_kind?: string
        }
        Relationships: []
      }
      paige_approval_comments: {
        Row: {
          approval_id: string
          author_id: string
          body: string
          created_at: string
          id: string
        }
        Insert: {
          approval_id: string
          author_id: string
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          approval_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_approval_comments_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_approval_queue_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_approval_comments_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_approval_policies: {
        Row: {
          active: boolean | null
          auto_assign_role: Database["public"]["Enums"]["app_role"] | null
          auto_assign_user_id: string | null
          category: string
          created_at: string | null
          id: string
          match_predicate: Json | null
          priority: number | null
          requires_role: Database["public"]["Enums"]["app_role"] | null
          risk_level: string | null
          sla_minutes: number | null
          tenant_id: string | null
          updated_at: string | null
          visible_to_roles: Database["public"]["Enums"]["app_role"][] | null
        }
        Insert: {
          active?: boolean | null
          auto_assign_role?: Database["public"]["Enums"]["app_role"] | null
          auto_assign_user_id?: string | null
          category: string
          created_at?: string | null
          id?: string
          match_predicate?: Json | null
          priority?: number | null
          requires_role?: Database["public"]["Enums"]["app_role"] | null
          risk_level?: string | null
          sla_minutes?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][] | null
        }
        Update: {
          active?: boolean | null
          auto_assign_role?: Database["public"]["Enums"]["app_role"] | null
          auto_assign_user_id?: string | null
          category?: string
          created_at?: string | null
          id?: string
          match_predicate?: Json | null
          priority?: number | null
          requires_role?: Database["public"]["Enums"]["app_role"] | null
          risk_level?: string | null
          sla_minutes?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][] | null
        }
        Relationships: []
      }
      paige_assignment_policy: {
        Row: {
          eligible_user_ids: string[]
          strategy: string
          target_role: string
          tier: string
          updated_at: string
        }
        Insert: {
          eligible_user_ids?: string[]
          strategy?: string
          target_role?: string
          tier: string
          updated_at?: string
        }
        Update: {
          eligible_user_ids?: string[]
          strategy?: string
          target_role?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      paige_audit_log: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          payload: Json
          target_id: string | null
          target_type: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_bank_connections: {
        Row: {
          accounts: Json
          connected_at: string
          contact_id: string
          created_at: string
          id: string
          institution_name: string | null
          last_synced_at: string | null
          plaid_access_token_encrypted: string | null
          plaid_item_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accounts?: Json
          connected_at?: string
          contact_id: string
          created_at?: string
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_access_token_encrypted?: string | null
          plaid_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accounts?: Json
          connected_at?: string
          contact_id?: string
          created_at?: string
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_access_token_encrypted?: string | null
          plaid_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_bank_transactions: {
        Row: {
          account_id: string | null
          amount_cents: number
          bank_connection_id: string
          category: Json | null
          created_at: string
          date: string
          id: string
          name: string | null
          pending: boolean
          plaid_transaction_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          bank_connection_id: string
          category?: Json | null
          created_at?: string
          date: string
          id?: string
          name?: string | null
          pending?: boolean
          plaid_transaction_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          bank_connection_id?: string
          category?: Json | null
          created_at?: string
          date?: string
          id?: string
          name?: string | null
          pending?: boolean
          plaid_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_bank_transactions_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "paige_bank_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_bookings: {
        Row: {
          attendee_email: string | null
          attendee_name: string | null
          attendee_responses: Json
          cal_event_id: string
          cal_event_type_id: string | null
          contact_id: string | null
          created_at: string
          duration_min: number | null
          event_type: Database["public"]["Enums"]["paige_booking_event_type"]
          id: string
          metadata: Json
          scheduled_at: string
          status: Database["public"]["Enums"]["paige_booking_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_responses?: Json
          cal_event_id: string
          cal_event_type_id?: string | null
          contact_id?: string | null
          created_at?: string
          duration_min?: number | null
          event_type?: Database["public"]["Enums"]["paige_booking_event_type"]
          id?: string
          metadata?: Json
          scheduled_at: string
          status?: Database["public"]["Enums"]["paige_booking_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_responses?: Json
          cal_event_id?: string
          cal_event_type_id?: string | null
          contact_id?: string | null
          created_at?: string
          duration_min?: number | null
          event_type?: Database["public"]["Enums"]["paige_booking_event_type"]
          id?: string
          metadata?: Json
          scheduled_at?: string
          status?: Database["public"]["Enums"]["paige_booking_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_bridge_auth_failures: {
        Row: {
          alerted_at: string | null
          function_name: string
          id: string
          ip: string | null
          occurred_at: string
          reason: string | null
          status: number
          user_agent: string | null
          verb: string | null
        }
        Insert: {
          alerted_at?: string | null
          function_name: string
          id?: string
          ip?: string | null
          occurred_at?: string
          reason?: string | null
          status: number
          user_agent?: string | null
          verb?: string | null
        }
        Update: {
          alerted_at?: string | null
          function_name?: string
          id?: string
          ip?: string | null
          occurred_at?: string
          reason?: string | null
          status?: number
          user_agent?: string | null
          verb?: string | null
        }
        Relationships: []
      }
      paige_business_credit_profiles: {
        Row: {
          business_name: string | null
          contact_id: string
          created_at: string
          ein: string | null
          history: Json
          id: string
          last_pulled_at: string | null
          nav_profile_id: string | null
          scores: Json
          trade_lines: Json
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          contact_id: string
          created_at?: string
          ein?: string | null
          history?: Json
          id?: string
          last_pulled_at?: string | null
          nav_profile_id?: string | null
          scores?: Json
          trade_lines?: Json
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          contact_id?: string
          created_at?: string
          ein?: string | null
          history?: Json
          id?: string
          last_pulled_at?: string | null
          nav_profile_id?: string | null
          scores?: Json
          trade_lines?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_business_credit_profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_business_credit_profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_business_credit_profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_business_credit_profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_cash_flow_snapshots: {
        Row: {
          avg_daily_balance_cents: number
          contact_id: string
          created_at: string
          funding_readiness_score: number | null
          generated_at: string
          id: string
          period_end: string
          period_start: string
          runway_days: number | null
          total_deposits_cents: number
          total_withdrawals_cents: number
        }
        Insert: {
          avg_daily_balance_cents?: number
          contact_id: string
          created_at?: string
          funding_readiness_score?: number | null
          generated_at?: string
          id?: string
          period_end: string
          period_start: string
          runway_days?: number | null
          total_deposits_cents?: number
          total_withdrawals_cents?: number
        }
        Update: {
          avg_daily_balance_cents?: number
          contact_id?: string
          created_at?: string
          funding_readiness_score?: number | null
          generated_at?: string
          id?: string
          period_end?: string
          period_start?: string
          runway_days?: number | null
          total_deposits_cents?: number
          total_withdrawals_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_chat_threads: {
        Row: {
          auto_delete_at: string | null
          caller_user_id: string
          consent_snapshot: Json | null
          contact_id: string | null
          created_at: string
          id: string
          is_archived: boolean
          last_message_at: string | null
          lens: string
          message_count: number
          summary: string | null
          summary_through_seq: number
          tenant_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          auto_delete_at?: string | null
          caller_user_id: string
          consent_snapshot?: Json | null
          contact_id?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          lens: string
          message_count?: number
          summary?: string | null
          summary_through_seq?: number
          tenant_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          auto_delete_at?: string | null
          caller_user_id?: string
          consent_snapshot?: Json | null
          contact_id?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          lens?: string
          message_count?: number
          summary?: string | null
          summary_through_seq?: number
          tenant_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_chat_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_chat_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_chat_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_chat_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_chat_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_chat_turns: {
        Row: {
          bundle_ref: Json | null
          content: string
          created_at: string
          id: string
          latency_ms: number | null
          load_id: string | null
          model: string | null
          role: string
          seq: number
          surfaces_used: string[] | null
          thread_id: string
          tokens_used: number | null
          tool_calls: Json | null
        }
        Insert: {
          bundle_ref?: Json | null
          content: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          load_id?: string | null
          model?: string | null
          role: string
          seq?: number
          surfaces_used?: string[] | null
          thread_id: string
          tokens_used?: number | null
          tool_calls?: Json | null
        }
        Update: {
          bundle_ref?: Json | null
          content?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          load_id?: string | null
          model?: string | null
          role?: string
          seq?: number
          surfaces_used?: string[] | null
          thread_id?: string
          tokens_used?: number | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_chat_turns_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "paige_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_client_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          audience: string
          contact_id: string
          created_at: string
          event_kind: string
          from_department: string | null
          id: string
          occurred_at: string
          payload: Json
          ref_id: string | null
          ref_table: string | null
          summary: string | null
          surface: string
          tenant_id: string
          title: string
          to_department: string | null
          visibility: string
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          audience: string
          contact_id: string
          created_at?: string
          event_kind: string
          from_department?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          ref_id?: string | null
          ref_table?: string | null
          summary?: string | null
          surface: string
          tenant_id: string
          title: string
          to_department?: string | null
          visibility: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          audience?: string
          contact_id?: string
          created_at?: string
          event_kind?: string
          from_department?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          ref_id?: string | null
          ref_table?: string | null
          summary?: string | null
          surface?: string
          tenant_id?: string
          title?: string
          to_department?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_client_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_client_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_client_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_client_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_client_events_event_kind_fkey"
            columns: ["event_kind"]
            isOneToOne: false
            referencedRelation: "paige_event_kinds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_client_events_from_department_fkey"
            columns: ["from_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_client_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_client_events_to_department_fkey"
            columns: ["to_department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
        ]
      }
      paige_client_intake_submissions: {
        Row: {
          client_id: string
          created_at: string
          id: string
          payload: Json
          section: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          payload?: Json
          section: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          payload?: Json
          section?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_client_intake_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_client_intake_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_client_intake_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_client_intake_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_coach_assignments: {
        Row: {
          active: boolean
          assigned_at: string
          assigned_role: string | null
          coach_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          notes: string | null
          rep_user_id: string | null
          role: string | null
          tenant_id: string | null
          unassigned_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_role?: string | null
          coach_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          rep_user_id?: string | null
          role?: string | null
          tenant_id?: string | null
          unassigned_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_role?: string | null
          coach_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          rep_user_id?: string | null
          role?: string | null
          tenant_id?: string | null
          unassigned_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_coach_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_config: {
        Row: {
          apollo_auto_enrich: boolean
          cal_default_event_type_id: string | null
          cal_event_type_map: Json
          created_at: string
          default_from_email: string | null
          default_from_sms_number: string | null
          docusign_default_brand_id: string | null
          docusign_enabled: boolean
          docusign_templates: Json
          ghl_fallback_enabled: boolean
          ghl_location_id: string | null
          ghl_pit_ref: string | null
          gmail_default_sender: string | null
          id: number
          langsmith_project: string | null
          meta_ads_features_enabled: boolean
          meta_capi_test_event_code: string | null
          meta_default_page_id: string | null
          meta_pixel_id: string | null
          meta_pixel_tracked_paths: Json
          nav_partner_id: string | null
          nav_threshold_delta: number | null
          plaid_activated: boolean | null
          plaid_env: string | null
          posthog_project_url: string | null
          resend_domain_verified: boolean
          sentry_org_slug: string | null
          sentry_project_slug: string | null
          smartcredit_enabled: boolean | null
          stripe_price_tier_map: Json | null
          telegram_command_surface_enabled: boolean
          twilio_a2p_status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          apollo_auto_enrich?: boolean
          cal_default_event_type_id?: string | null
          cal_event_type_map?: Json
          created_at?: string
          default_from_email?: string | null
          default_from_sms_number?: string | null
          docusign_default_brand_id?: string | null
          docusign_enabled?: boolean
          docusign_templates?: Json
          ghl_fallback_enabled?: boolean
          ghl_location_id?: string | null
          ghl_pit_ref?: string | null
          gmail_default_sender?: string | null
          id?: number
          langsmith_project?: string | null
          meta_ads_features_enabled?: boolean
          meta_capi_test_event_code?: string | null
          meta_default_page_id?: string | null
          meta_pixel_id?: string | null
          meta_pixel_tracked_paths?: Json
          nav_partner_id?: string | null
          nav_threshold_delta?: number | null
          plaid_activated?: boolean | null
          plaid_env?: string | null
          posthog_project_url?: string | null
          resend_domain_verified?: boolean
          sentry_org_slug?: string | null
          sentry_project_slug?: string | null
          smartcredit_enabled?: boolean | null
          stripe_price_tier_map?: Json | null
          telegram_command_surface_enabled?: boolean
          twilio_a2p_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          apollo_auto_enrich?: boolean
          cal_default_event_type_id?: string | null
          cal_event_type_map?: Json
          created_at?: string
          default_from_email?: string | null
          default_from_sms_number?: string | null
          docusign_default_brand_id?: string | null
          docusign_enabled?: boolean
          docusign_templates?: Json
          ghl_fallback_enabled?: boolean
          ghl_location_id?: string | null
          ghl_pit_ref?: string | null
          gmail_default_sender?: string | null
          id?: number
          langsmith_project?: string | null
          meta_ads_features_enabled?: boolean
          meta_capi_test_event_code?: string | null
          meta_default_page_id?: string | null
          meta_pixel_id?: string | null
          meta_pixel_tracked_paths?: Json
          nav_partner_id?: string | null
          nav_threshold_delta?: number | null
          plaid_activated?: boolean | null
          plaid_env?: string | null
          posthog_project_url?: string | null
          resend_domain_verified?: boolean
          sentry_org_slug?: string | null
          sentry_project_slug?: string | null
          smartcredit_enabled?: boolean | null
          stripe_price_tier_map?: Json | null
          telegram_command_surface_enabled?: boolean
          twilio_a2p_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      paige_context_loads: {
        Row: {
          caller_role: string
          caller_user_id: string
          consent_state: string
          contact_id: string | null
          created_at: string
          id: string
          row_count: number
          scope: string
          surfaces_used: string[]
          tenant_id: string | null
          token_estimate: number
        }
        Insert: {
          caller_role?: string
          caller_user_id: string
          consent_state?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          row_count?: number
          scope: string
          surfaces_used?: string[]
          tenant_id?: string | null
          token_estimate?: number
        }
        Update: {
          caller_role?: string
          caller_user_id?: string
          consent_state?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          row_count?: number
          scope?: string
          surfaces_used?: string[]
          tenant_id?: string | null
          token_estimate?: number
        }
        Relationships: []
      }
      paige_conversations: {
        Row: {
          body: string
          channel: string
          contact_id: string | null
          created_at: string
          direction: string
          id: string
          metadata: Json
          source_message_id: string | null
          status: string
          subject: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel: string
          contact_id?: string | null
          created_at?: string
          direction: string
          id?: string
          metadata?: Json
          source_message_id?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          contact_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          metadata?: Json
          source_message_id?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_customer_actions: {
        Row: {
          action_type: string
          body: string | null
          contact_id: string
          created_at: string
          expires_at: string
          id: string
          initiated_by_admin_id: string
          payload_json: Json
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          action_type: string
          body?: string | null
          contact_id: string
          created_at?: string
          expires_at?: string
          id?: string
          initiated_by_admin_id: string
          payload_json?: Json
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          body?: string | null
          contact_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          initiated_by_admin_id?: string
          payload_json?: Json
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_customer_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_customer_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_customer_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_customer_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_customer_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_customer_responses: {
        Row: {
          action_id: string
          contact_id: string
          created_at: string
          id: string
          responded_by_user_id: string
          response_text: string | null
          response_type: string
        }
        Insert: {
          action_id: string
          contact_id: string
          created_at?: string
          id?: string
          responded_by_user_id: string
          response_text?: string | null
          response_type: string
        }
        Update: {
          action_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          responded_by_user_id?: string
          response_text?: string | null
          response_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_customer_responses_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "paige_customer_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_customer_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_customer_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_customer_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_customer_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_data_source_registry: {
        Row: {
          column_name: string | null
          context_field_whitelist: string[]
          context_fk_column: string | null
          context_max_rows: number
          context_priority: number
          context_scope: string
          created_at: string
          ecosystem_owner: string
          external_source_label: string | null
          field_key: string
          id: string
          notes: string | null
          paige_context_eligible: boolean
          pii_sensitive: boolean
          realtime_enabled: boolean
          staleness_ttl_seconds: number | null
          surface: string
          sync_mechanism: string
          table_name: string | null
          updated_at: string
        }
        Insert: {
          column_name?: string | null
          context_field_whitelist?: string[]
          context_fk_column?: string | null
          context_max_rows?: number
          context_priority?: number
          context_scope?: string
          created_at?: string
          ecosystem_owner: string
          external_source_label?: string | null
          field_key: string
          id?: string
          notes?: string | null
          paige_context_eligible?: boolean
          pii_sensitive?: boolean
          realtime_enabled?: boolean
          staleness_ttl_seconds?: number | null
          surface: string
          sync_mechanism: string
          table_name?: string | null
          updated_at?: string
        }
        Update: {
          column_name?: string | null
          context_field_whitelist?: string[]
          context_fk_column?: string | null
          context_max_rows?: number
          context_priority?: number
          context_scope?: string
          created_at?: string
          ecosystem_owner?: string
          external_source_label?: string | null
          field_key?: string
          id?: string
          notes?: string | null
          paige_context_eligible?: boolean
          pii_sensitive?: boolean
          realtime_enabled?: boolean
          staleness_ttl_seconds?: number | null
          surface?: string
          sync_mechanism?: string
          table_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      paige_data_source_sync_state: {
        Row: {
          created_at: string
          id: string
          last_sync_error: string | null
          last_sync_status: string
          last_synced_at: string
          record_count: number | null
          source_key: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_sync_error?: string | null
          last_sync_status?: string
          last_synced_at?: string
          record_count?: number | null
          source_key: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_sync_error?: string | null
          last_sync_status?: string
          last_synced_at?: string
          record_count?: number | null
          source_key?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_data_source_sync_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_departments: {
        Row: {
          audience: string
          description: string
          display_order: number
          enabled: boolean
          escalation: Json
          kpis: Json
          mandate: string | null
          name: string
          slug: string
        }
        Insert: {
          audience: string
          description: string
          display_order?: number
          enabled?: boolean
          escalation?: Json
          kpis?: Json
          mandate?: string | null
          name: string
          slug: string
        }
        Update: {
          audience?: string
          description?: string
          display_order?: number
          enabled?: boolean
          escalation?: Json
          kpis?: Json
          mandate?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      paige_enrichment_log: {
        Row: {
          contact_id: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          provider: string
          subject_key: string
          subject_type: Database["public"]["Enums"]["paige_enrichment_subject_type"]
          succeeded: boolean
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          provider?: string
          subject_key: string
          subject_type: Database["public"]["Enums"]["paige_enrichment_subject_type"]
          succeeded?: boolean
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          provider?: string
          subject_key?: string
          subject_type?: Database["public"]["Enums"]["paige_enrichment_subject_type"]
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "paige_enrichment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_enrichment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_enrichment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_enrichment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_event_kinds: {
        Row: {
          created_at: string
          default_audience: string
          default_visibility: string
          department: string | null
          description: string | null
          enabled: boolean
          label: string
          slug: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          default_audience?: string
          default_visibility?: string
          department?: string | null
          description?: string | null
          enabled?: boolean
          label: string
          slug: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          default_audience?: string
          default_visibility?: string
          department?: string | null
          description?: string | null
          enabled?: boolean
          label?: string
          slug?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_event_kinds_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_event_kinds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_health_snapshots: {
        Row: {
          components: Json
          computed_at: string
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          score: number
        }
        Insert: {
          components?: Json
          computed_at?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          score: number
        }
        Update: {
          components?: Json
          computed_at?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "paige_health_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_health_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_health_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_health_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_ingestion_proposals: {
        Row: {
          actor_label: string | null
          actor_role: string
          actor_user_id: string | null
          applied_row_ids: Json | null
          client_id: string | null
          confidence: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          diff: Json
          expires_at: string
          external_llm_model: string | null
          id: string
          payload: Json
          review_reason: string | null
          source: string
          status: string
          target_table: string | null
          tenant_id: string | null
          tool_name: string
        }
        Insert: {
          actor_label?: string | null
          actor_role?: string
          actor_user_id?: string | null
          applied_row_ids?: Json | null
          client_id?: string | null
          confidence?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          diff?: Json
          expires_at?: string
          external_llm_model?: string | null
          id?: string
          payload?: Json
          review_reason?: string | null
          source?: string
          status?: string
          target_table?: string | null
          tenant_id?: string | null
          tool_name: string
        }
        Update: {
          actor_label?: string | null
          actor_role?: string
          actor_user_id?: string | null
          applied_row_ids?: Json | null
          client_id?: string | null
          confidence?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          diff?: Json
          expires_at?: string
          external_llm_model?: string | null
          id?: string
          payload?: Json
          review_reason?: string | null
          source?: string
          status?: string
          target_table?: string | null
          tenant_id?: string | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_ingestion_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_ingestion_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_ingestion_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_ingestion_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_invoices: {
        Row: {
          amount_total_cents: number
          contact_id: string
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          due_date: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_number: string
          line_items: Json
          memo: string | null
          paid_at: string | null
          payment_plan_key: string | null
          sent_at: string | null
          sent_to_email: string | null
          status: string
          stripe_invoice_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_total_cents: number
          contact_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_number: string
          line_items?: Json
          memo?: string | null
          paid_at?: string | null
          payment_plan_key?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_total_cents?: number
          contact_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_number?: string
          line_items?: Json
          memo?: string | null
          paid_at?: string | null
          payment_plan_key?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_journey_stage_transitions: {
        Row: {
          contact_id: string
          from_stage_id: number | null
          id: string
          metadata: Json
          source_event: string | null
          to_stage_id: number
          transitioned_at: string
          transitioned_by: string | null
        }
        Insert: {
          contact_id: string
          from_stage_id?: number | null
          id?: string
          metadata?: Json
          source_event?: string | null
          to_stage_id: number
          transitioned_at?: string
          transitioned_by?: string | null
        }
        Update: {
          contact_id?: string
          from_stage_id?: number | null
          id?: string
          metadata?: Json
          source_event?: string | null
          to_stage_id?: number
          transitioned_at?: string
          transitioned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_journey_stage_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_journey_stage_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_journey_stage_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_journey_stage_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_journey_stage_transitions_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "paige_journey_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_journey_stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "paige_journey_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_journey_stages: {
        Row: {
          color_hex: string | null
          created_at: string
          description: string | null
          display_order: number
          id: number
          label: string
          slug: string
        }
        Insert: {
          color_hex?: string | null
          created_at?: string
          description?: string | null
          display_order: number
          id: number
          label: string
          slug: string
        }
        Update: {
          color_hex?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: number
          label?: string
          slug?: string
        }
        Relationships: []
      }
      paige_mcp_connections: {
        Row: {
          auth_token_last4: string | null
          auth_token_ref: string | null
          created_at: string
          enabled: boolean
          id: string
          label: string
          last_probed_at: string | null
          server_url_ct: string | null
          tools_cache: Json | null
          transport: string
          updated_at: string
        }
        Insert: {
          auth_token_last4?: string | null
          auth_token_ref?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label: string
          last_probed_at?: string | null
          server_url_ct?: string | null
          tools_cache?: Json | null
          transport?: string
          updated_at?: string
        }
        Update: {
          auth_token_last4?: string | null
          auth_token_ref?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          last_probed_at?: string | null
          server_url_ct?: string | null
          tools_cache?: Json | null
          transport?: string
          updated_at?: string
        }
        Relationships: []
      }
      paige_mcp_oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          client_uri: string | null
          created_at: string
          created_by_user_id: string | null
          grant_types: string[]
          redirect_uris: string[]
          response_types: string[]
          scope: string
          token_endpoint_auth_method: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_name: string
          client_uri?: string | null
          created_at?: string
          created_by_user_id?: string | null
          grant_types?: string[]
          redirect_uris: string[]
          response_types?: string[]
          scope?: string
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_name?: string
          client_uri?: string | null
          created_at?: string
          created_by_user_id?: string | null
          grant_types?: string[]
          redirect_uris?: string[]
          response_types?: string[]
          scope?: string
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Relationships: []
      }
      paige_mcp_oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_mcp_oauth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      paige_mcp_oauth_tokens: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          client_name_cache: string | null
          created_at: string
          id: string
          last_used_at: string | null
          refresh_expires_at: string | null
          refresh_token_hash: string | null
          revoked_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          client_name_cache?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes: string[]
          user_id: string
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          client_id?: string
          client_name_cache?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_mcp_oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      paige_messages_audit: {
        Row: {
          body: string | null
          channel: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          from_address: string | null
          id: string
          pipe_used: string
          sent_at: string | null
          status: string
          subject: string | null
          to_address: string
          updated_at: string
          vendor_message_id: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          from_address?: string | null
          id?: string
          pipe_used: string
          sent_at?: string | null
          status: string
          subject?: string | null
          to_address: string
          updated_at?: string
          vendor_message_id?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          from_address?: string | null
          id?: string
          pipe_used?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          to_address?: string
          updated_at?: string
          vendor_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_messages_audit_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_messages_audit_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_messages_audit_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_messages_audit_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_messages_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "paige_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_n8n_connections: {
        Row: {
          api_key_last4: string | null
          api_key_ref: string | null
          base_url_ct: string | null
          created_at: string
          id: string
          is_default: boolean
          label: string
          last_sync_at: string | null
          updated_at: string
          workflows_cache: Json | null
        }
        Insert: {
          api_key_last4?: string | null
          api_key_ref?: string | null
          base_url_ct?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          last_sync_at?: string | null
          updated_at?: string
          workflows_cache?: Json | null
        }
        Update: {
          api_key_last4?: string | null
          api_key_ref?: string | null
          base_url_ct?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          last_sync_at?: string | null
          updated_at?: string
          workflows_cache?: Json | null
        }
        Relationships: []
      }
      paige_nps_responses: {
        Row: {
          campaign_or_survey: string | null
          contact_id: string | null
          created_at: string
          feedback: string | null
          follow_up_status: string
          id: string
          metadata: Json
          score: number
          submitted_at: string
          updated_at: string
        }
        Insert: {
          campaign_or_survey?: string | null
          contact_id?: string | null
          created_at?: string
          feedback?: string | null
          follow_up_status?: string
          id?: string
          metadata?: Json
          score: number
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          campaign_or_survey?: string | null
          contact_id?: string | null
          created_at?: string
          feedback?: string | null
          follow_up_status?: string
          id?: string
          metadata?: Json
          score?: number
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_nps_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_nps_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_nps_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_nps_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_owner_credit_snapshots: {
        Row: {
          alerts_triggered: Json
          bureau: Database["public"]["Enums"]["owner_credit_bureau"]
          contact_id: string
          created_at: string
          factors: Json
          id: string
          pulled_at: string
          score: number | null
        }
        Insert: {
          alerts_triggered?: Json
          bureau: Database["public"]["Enums"]["owner_credit_bureau"]
          contact_id: string
          created_at?: string
          factors?: Json
          id?: string
          pulled_at?: string
          score?: number | null
        }
        Update: {
          alerts_triggered?: Json
          bureau?: Database["public"]["Enums"]["owner_credit_bureau"]
          contact_id?: string
          created_at?: string
          factors?: Json
          id?: string
          pulled_at?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_payment_authorizations: {
        Row: {
          authorized_at: string
          client_id: string
          created_at: string
          id: string
          ip: unknown
          plan_selected: string
          recurring_auth_text_snapshot: string | null
          status: string
          stripe_customer_id_ct: string | null
          stripe_payment_method_id_ct: string | null
          stripe_subscription_id_ct: string | null
          user_agent: string | null
        }
        Insert: {
          authorized_at?: string
          client_id: string
          created_at?: string
          id?: string
          ip?: unknown
          plan_selected: string
          recurring_auth_text_snapshot?: string | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_payment_method_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          user_agent?: string | null
        }
        Update: {
          authorized_at?: string
          client_id?: string
          created_at?: string
          id?: string
          ip?: unknown
          plan_selected?: string
          recurring_auth_text_snapshot?: string | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_payment_method_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_payment_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_payment_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_payment_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_payment_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_pending_approvals: {
        Row: {
          assigned_to_user_id: string | null
          category: string | null
          claimed_at: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by_n8n_workflow_key: string | null
          decision_rationale: string | null
          draft_content: Json
          escalation_note: string | null
          id: string
          metadata: Json
          priority: number | null
          requires_role: Database["public"]["Enums"]["app_role"] | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          risk_level: string | null
          sent_at: string | null
          sent_message_audit_id: string | null
          sla_due_at: string | null
          source: string | null
          status: string
          submitted_by_user_id: string | null
          summary: string | null
          tenant_id: string | null
          type: string
          updated_at: string
          visible_to_roles: string[]
        }
        Insert: {
          assigned_to_user_id?: string | null
          category?: string | null
          claimed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_n8n_workflow_key?: string | null
          decision_rationale?: string | null
          draft_content: Json
          escalation_note?: string | null
          id?: string
          metadata?: Json
          priority?: number | null
          requires_role?: Database["public"]["Enums"]["app_role"] | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          risk_level?: string | null
          sent_at?: string | null
          sent_message_audit_id?: string | null
          sla_due_at?: string | null
          source?: string | null
          status?: string
          submitted_by_user_id?: string | null
          summary?: string | null
          tenant_id?: string | null
          type: string
          updated_at?: string
          visible_to_roles?: string[]
        }
        Update: {
          assigned_to_user_id?: string | null
          category?: string | null
          claimed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_n8n_workflow_key?: string | null
          decision_rationale?: string | null
          draft_content?: Json
          escalation_note?: string | null
          id?: string
          metadata?: Json
          priority?: number | null
          requires_role?: Database["public"]["Enums"]["app_role"] | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          risk_level?: string | null
          sent_at?: string | null
          sent_message_audit_id?: string | null
          sla_due_at?: string | null
          source?: string | null
          status?: string
          submitted_by_user_id?: string | null
          summary?: string | null
          tenant_id?: string | null
          type?: string
          updated_at?: string
          visible_to_roles?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "paige_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_sent_message_audit_id_fkey"
            columns: ["sent_message_audit_id"]
            isOneToOne: false
            referencedRelation: "paige_messages_audit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_readiness_proposals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          compose_intent: string
          contact_id: string
          created_at: string
          envelope_json: Json
          executed_at: string | null
          expires_at: string
          id: string
          proposed_at: string
          readiness_delta_json: Json
          recommended_actions_json: Json
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          scan_run_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          compose_intent?: string
          contact_id: string
          created_at?: string
          envelope_json?: Json
          executed_at?: string | null
          expires_at?: string
          id?: string
          proposed_at?: string
          readiness_delta_json?: Json
          recommended_actions_json?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          scan_run_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          compose_intent?: string
          contact_id?: string
          created_at?: string
          envelope_json?: Json
          executed_at?: string | null
          expires_at?: string
          id?: string
          proposed_at?: string
          readiness_delta_json?: Json
          recommended_actions_json?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          scan_run_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_readiness_proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_readiness_proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_readiness_proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_readiness_proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_readiness_proposals_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "paige_readiness_scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_readiness_proposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_readiness_scan_runs: {
        Row: {
          cadence: string
          contacts_scanned: number
          created_at: string
          credit_provider_calls_count: number
          credit_provider_cost_usd: number
          errors_json: Json
          finished_at: string | null
          id: string
          proposals_generated: number
          proposals_insufficient_data: number
          started_at: string
          status: string
          tenant_id: string
          trigger_source: string
        }
        Insert: {
          cadence?: string
          contacts_scanned?: number
          created_at?: string
          credit_provider_calls_count?: number
          credit_provider_cost_usd?: number
          errors_json?: Json
          finished_at?: string | null
          id?: string
          proposals_generated?: number
          proposals_insufficient_data?: number
          started_at?: string
          status?: string
          tenant_id: string
          trigger_source?: string
        }
        Update: {
          cadence?: string
          contacts_scanned?: number
          created_at?: string
          credit_provider_calls_count?: number
          credit_provider_cost_usd?: number
          errors_json?: Json
          finished_at?: string | null
          id?: string
          proposals_generated?: number
          proposals_insufficient_data?: number
          started_at?: string
          status?: string
          tenant_id?: string
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_readiness_scan_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_referrals: {
        Row: {
          conversion_event: string | null
          created_at: string
          credit_amount_cents: number | null
          credited_at: string | null
          id: string
          metadata: Json
          referred_at: string
          referred_contact_id: string | null
          referred_email: string | null
          referrer_contact_id: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          conversion_event?: string | null
          created_at?: string
          credit_amount_cents?: number | null
          credited_at?: string | null
          id?: string
          metadata?: Json
          referred_at?: string
          referred_contact_id?: string | null
          referred_email?: string | null
          referrer_contact_id?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          conversion_event?: string | null
          created_at?: string
          credit_amount_cents?: number | null
          credited_at?: string | null
          id?: string
          metadata?: Json
          referred_at?: string
          referred_contact_id?: string | null
          referred_email?: string | null
          referrer_contact_id?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_referrals_referred_contact_id_fkey"
            columns: ["referred_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_referrals_referred_contact_id_fkey"
            columns: ["referred_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_referrals_referred_contact_id_fkey"
            columns: ["referred_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_referrals_referred_contact_id_fkey"
            columns: ["referred_contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_referrals_referrer_contact_id_fkey"
            columns: ["referrer_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_referrals_referrer_contact_id_fkey"
            columns: ["referrer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_referrals_referrer_contact_id_fkey"
            columns: ["referrer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_referrals_referrer_contact_id_fkey"
            columns: ["referrer_contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_signature_envelopes: {
        Row: {
          completed_pdf_url: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          envelope_id: string
          envelope_type: Database["public"]["Enums"]["paige_envelope_type"]
          id: string
          metadata: Json
          sent_at: string
          signed_at: string | null
          status: Database["public"]["Enums"]["paige_envelope_status"]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          completed_pdf_url?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          envelope_id: string
          envelope_type?: Database["public"]["Enums"]["paige_envelope_type"]
          id?: string
          metadata?: Json
          sent_at?: string
          signed_at?: string | null
          status?: Database["public"]["Enums"]["paige_envelope_status"]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_pdf_url?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          envelope_id?: string
          envelope_type?: Database["public"]["Enums"]["paige_envelope_type"]
          id?: string
          metadata?: Json
          sent_at?: string
          signed_at?: string | null
          status?: Database["public"]["Enums"]["paige_envelope_status"]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_signed_agreements: {
        Row: {
          agreement_template_key: string
          agreement_text_snapshot: string
          agreement_version: string
          client_id: string
          created_at: string
          id: string
          ip: unknown
          signature_data: Json
          signed_at: string
          signed_pdf_path: string | null
          user_agent: string | null
        }
        Insert: {
          agreement_template_key: string
          agreement_text_snapshot: string
          agreement_version: string
          client_id: string
          created_at?: string
          id?: string
          ip?: unknown
          signature_data?: Json
          signed_at?: string
          signed_pdf_path?: string | null
          user_agent?: string | null
        }
        Update: {
          agreement_template_key?: string
          agreement_text_snapshot?: string
          agreement_version?: string
          client_id?: string
          created_at?: string
          id?: string
          ip?: unknown
          signature_data?: Json
          signed_at?: string
          signed_pdf_path?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_signed_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_signed_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signed_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signed_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_skill_proposals: {
        Row: {
          allowed_tools: string[]
          category: string
          created_at: string
          decided_at: string | null
          description: string | null
          id: string
          input_schema: Json
          proposed_name: string
          proposed_slug: string
          published_skill_id: string | null
          rationale: string | null
          reviewer_notes: string | null
          reviewer_user_id: string | null
          risk_level: string
          source_pattern: Json
          status: string
          steps: Json
          trigger_phrases: string[]
        }
        Insert: {
          allowed_tools?: string[]
          category?: string
          created_at?: string
          decided_at?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          proposed_name: string
          proposed_slug: string
          published_skill_id?: string | null
          rationale?: string | null
          reviewer_notes?: string | null
          reviewer_user_id?: string | null
          risk_level?: string
          source_pattern?: Json
          status?: string
          steps?: Json
          trigger_phrases?: string[]
        }
        Update: {
          allowed_tools?: string[]
          category?: string
          created_at?: string
          decided_at?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          proposed_name?: string
          proposed_slug?: string
          published_skill_id?: string | null
          rationale?: string | null
          reviewer_notes?: string | null
          reviewer_user_id?: string | null
          risk_level?: string
          source_pattern?: Json
          status?: string
          steps?: Json
          trigger_phrases?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "paige_skill_proposals_published_skill_id_fkey"
            columns: ["published_skill_id"]
            isOneToOne: false
            referencedRelation: "paige_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_skill_runs: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          cost_cents: number
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          inputs: Json
          invoker_kind: string
          invoker_user_id: string | null
          outputs: Json
          skill_id: string
          skill_slug: string
          status: string
          steps_log: Json
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          inputs?: Json
          invoker_kind?: string
          invoker_user_id?: string | null
          outputs?: Json
          skill_id: string
          skill_slug: string
          status?: string
          steps_log?: Json
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          inputs?: Json
          invoker_kind?: string
          invoker_user_id?: string | null
          outputs?: Json
          skill_id?: string
          skill_slug?: string
          status?: string
          steps_log?: Json
        }
        Relationships: [
          {
            foreignKeyName: "paige_skill_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_skill_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_skill_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_skill_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_skill_runs_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "paige_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_skills: {
        Row: {
          allowed_tools: string[]
          category: string
          cost_estimate_cents: number
          created_at: string
          created_by: string
          created_by_user_id: string | null
          description: string | null
          external_send: boolean | null
          id: string
          input_schema: Json
          metadata: Json
          mutating: boolean | null
          name: string
          require_admin_confirm_first_n: number
          risk_level: string
          run_count: number
          slug: string
          status: string
          steps: Json
          success_count: number
          trigger_phrases: string[]
          updated_at: string
          version: number
        }
        Insert: {
          allowed_tools?: string[]
          category?: string
          cost_estimate_cents?: number
          created_at?: string
          created_by?: string
          created_by_user_id?: string | null
          description?: string | null
          external_send?: boolean | null
          id?: string
          input_schema?: Json
          metadata?: Json
          mutating?: boolean | null
          name: string
          require_admin_confirm_first_n?: number
          risk_level?: string
          run_count?: number
          slug: string
          status?: string
          steps?: Json
          success_count?: number
          trigger_phrases?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          allowed_tools?: string[]
          category?: string
          cost_estimate_cents?: number
          created_at?: string
          created_by?: string
          created_by_user_id?: string | null
          description?: string | null
          external_send?: boolean | null
          id?: string
          input_schema?: Json
          metadata?: Json
          mutating?: boolean | null
          name?: string
          require_admin_confirm_first_n?: number
          risk_level?: string
          run_count?: number
          slug?: string
          status?: string
          steps?: Json
          success_count?: number
          trigger_phrases?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      paige_sla_alert_log: {
        Row: {
          category: string
          client_id: string | null
          hours_unassigned: number | null
          id: string
          metadata: Json
          sent_at: string
          severity: string
        }
        Insert: {
          category: string
          client_id?: string | null
          hours_unassigned?: number | null
          id?: string
          metadata?: Json
          sent_at?: string
          severity: string
        }
        Update: {
          category?: string
          client_id?: string | null
          hours_unassigned?: number | null
          id?: string
          metadata?: Json
          sent_at?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_sla_alert_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_sla_alert_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_sla_alert_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_sla_alert_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_accounts: {
        Row: {
          account_id: string
          account_kind: string
          authorization_expires_at: string | null
          authorization_scopes: string[]
          avatar_url: string | null
          connected_at: string | null
          connected_by: string | null
          connection_id: string | null
          capabilities: string[]
          capabilities_verified_at: string | null
          created_at: string
          credentials_vault_ref: string | null
          display_name: string | null
          handle: string | null
          id: string
          last_synced_at: string | null
          last_verified_at: string | null
          platform: string
          provider_key: string
          revoked_at: string | null
          selected: boolean
          selected_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          account_kind?: string
          authorization_expires_at?: string | null
          authorization_scopes?: string[]
          avatar_url?: string | null
          connected_at?: string | null
          connected_by?: string | null
          connection_id?: string | null
          capabilities?: string[]
          capabilities_verified_at?: string | null
          created_at?: string
          credentials_vault_ref?: string | null
          display_name?: string | null
          handle?: string | null
          id?: string
          last_synced_at?: string | null
          last_verified_at?: string | null
          platform: string
          provider_key: string
          revoked_at?: string | null
          selected?: boolean
          selected_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_kind?: string
          authorization_expires_at?: string | null
          authorization_scopes?: string[]
          avatar_url?: string | null
          connected_at?: string | null
          connected_by?: string | null
          connection_id?: string | null
          capabilities?: string[]
          capabilities_verified_at?: string | null
          created_at?: string
          credentials_vault_ref?: string | null
          display_name?: string | null
          handle?: string | null
          id?: string
          last_synced_at?: string | null
          last_verified_at?: string | null
          platform?: string
          provider_key?: string
          revoked_at?: string | null
          selected?: boolean
          selected_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_accounts_connection_fk"
            columns: ["tenant_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "paige_social_connections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_connection_attempts: {
        Row: {
          completed_at: string | null
          confirmation_id: string
          connection_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          processing_at: string | null
          provider_error_code: string | null
          requested_platform: string | null
          provider_status: string | null
          return_path: string
          state: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          completed_at?: string | null
          confirmation_id: string
          connection_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          processing_at?: string | null
          provider_error_code?: string | null
          requested_platform?: string | null
          provider_status?: string | null
          return_path: string
          state?: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          completed_at?: string | null
          confirmation_id?: string
          connection_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          processing_at?: string | null
          provider_error_code?: string | null
          requested_platform?: string | null
          provider_status?: string | null
          return_path?: string
          state?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_connection_attempts_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_connection_attempts_connection_fk"
            columns: ["tenant_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "paige_social_connections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_connection_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_connections: {
        Row: {
          authorization_expires_at: string | null
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          failure_code: string | null
          id: string
          label: string | null
          last_verified_at: string | null
          provider_key: string
          provider_profile_key: string
          status: string
          tenant_id: string
          requested_platform: string | null
          updated_at: string
        }
        Insert: {
          authorization_expires_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          failure_code?: string | null
          id?: string
          label?: string | null
          last_verified_at?: string | null
          provider_key: string
          provider_profile_key: string
          status?: string
          tenant_id: string
          requested_platform?: string | null
          updated_at?: string
        }
        Update: {
          authorization_expires_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          failure_code?: string | null
          id?: string
          label?: string | null
          last_verified_at?: string | null
          provider_key?: string
          provider_profile_key?: string
          status?: string
          tenant_id?: string
          requested_platform?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_jobs: {
        Row: {
          approval_id: string | null
          attempt_count: number
          claimed_at: string | null
          confirmation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          job_kind: string
          last_error_code: string | null
          lease_until: string | null
          max_attempts: number
          next_attempt_at: string | null
          receipt_event_id: string | null
          reconciliation_required: boolean
          scheduled_for: string | null
          state: string
          target_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          attempt_count?: number
          claimed_at?: string | null
          confirmation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          job_kind: string
          last_error_code?: string | null
          lease_until?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          receipt_event_id?: string | null
          reconciliation_required?: boolean
          scheduled_for?: string | null
          state?: string
          target_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          attempt_count?: number
          claimed_at?: string | null
          confirmation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          job_kind?: string
          last_error_code?: string | null
          lease_until?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          receipt_event_id?: string | null
          reconciliation_required?: boolean
          scheduled_for?: string | null
          state?: string
          target_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_jobs_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_jobs_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_jobs_receipt_event_id_fkey"
            columns: ["receipt_event_id"]
            isOneToOne: false
            referencedRelation: "paige_workspace_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_jobs_target_fk"
            columns: ["tenant_id", "target_id"]
            isOneToOne: false
            referencedRelation: "paige_social_targets"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_post_versions: {
        Row: {
          content: string
          content_hash: string
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          id: string
          media_assets: Json
          post_id: string
          tenant_id: string
          version_number: number
        }
        Insert: {
          content: string
          content_hash: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          id?: string
          media_assets?: Json
          post_id: string
          tenant_id: string
          version_number: number
        }
        Update: {
          content?: string
          content_hash?: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          id?: string
          media_assets?: Json
          post_id?: string
          tenant_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_post_versions_post_fk"
            columns: ["tenant_id", "post_id"]
            isOneToOne: false
            referencedRelation: "paige_social_posts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_post_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_posts: {
        Row: {
          abandoned_at: string | null
          archived_at: string | null
          campaign_brief_id: string | null
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          id: string
          source_asset_id: string | null
          source_asset_kind: string | null
          source_kind: string
          source_license: string | null
          source_provenance: Json
          source_provider: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          abandoned_at?: string | null
          archived_at?: string | null
          campaign_brief_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          id?: string
          source_asset_id?: string | null
          source_asset_kind?: string | null
          source_kind?: string
          source_license?: string | null
          source_provenance?: Json
          source_provider?: string | null
          status?: string
          tenant_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          abandoned_at?: string | null
          archived_at?: string | null
          campaign_brief_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          id?: string
          source_asset_id?: string | null
          source_asset_kind?: string | null
          source_kind?: string
          source_license?: string | null
          source_provenance?: Json
          source_provider?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_posts_campaign_brief_id_fkey"
            columns: ["campaign_brief_id"]
            isOneToOne: false
            referencedRelation: "campaign_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_provider_results: {
        Row: {
          canonical_post_url: string | null
          created_at: string
          id: string
          job_id: string
          outcome: string
          provider_account_id: string
          provider_key: string
          provider_post_id: string | null
          provider_request_id: string | null
          readback: Json
          readback_observed_at: string | null
          target_id: string
          tenant_id: string
        }
        Insert: {
          canonical_post_url?: string | null
          created_at?: string
          id?: string
          job_id: string
          outcome: string
          provider_account_id: string
          provider_key: string
          provider_post_id?: string | null
          provider_request_id?: string | null
          readback?: Json
          readback_observed_at?: string | null
          target_id: string
          tenant_id: string
        }
        Update: {
          canonical_post_url?: string | null
          created_at?: string
          id?: string
          job_id?: string
          outcome?: string
          provider_account_id?: string
          provider_key?: string
          provider_post_id?: string | null
          provider_request_id?: string | null
          readback?: Json
          readback_observed_at?: string | null
          target_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_provider_results_job_fk"
            columns: ["tenant_id", "job_id"]
            isOneToOne: false
            referencedRelation: "paige_social_jobs"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_provider_results_target_fk"
            columns: ["tenant_id", "target_id"]
            isOneToOne: false
            referencedRelation: "paige_social_targets"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_provider_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_social_targets: {
        Row: {
          account_id: string
          approval_id: string | null
          created_at: string
          desired_publish_at: string | null
          id: string
          platform: string
          post_id: string
          status: string
          tenant_id: string
          updated_at: string
          version_id: string
        }
        Insert: {
          account_id: string
          approval_id?: string | null
          created_at?: string
          desired_publish_at?: string | null
          id?: string
          platform: string
          post_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          version_id: string
        }
        Update: {
          account_id?: string
          approval_id?: string | null
          created_at?: string
          desired_publish_at?: string | null
          id?: string
          platform?: string
          post_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_social_targets_account_fk"
            columns: ["tenant_id", "account_id"]
            isOneToOne: false
            referencedRelation: "paige_social_accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "paige_social_targets_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "paige_pending_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_social_targets_version_fk"
            columns: ["tenant_id", "post_id", "version_id"]
            isOneToOne: false
            referencedRelation: "paige_social_post_versions"
            referencedColumns: ["tenant_id", "post_id", "id"]
          },
        ]
      }
      paige_media_credit_entries: {
        Row: {
          id: string
          tenant_id: string
          entry_type: string
          credits: number
          job_id: string | null
          idempotency_key: string
          month_bucket: string | null
          included_credits: number
          purchased_credits: number
          source: string
          reason: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          entry_type: string
          credits: number
          job_id?: string | null
          idempotency_key: string
          month_bucket?: string | null
          included_credits?: number
          purchased_credits?: number
          source?: string
          reason?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          entry_type?: string
          credits?: number
          job_id?: string | null
          idempotency_key?: string
          month_bucket?: string | null
          included_credits?: number
          purchased_credits?: number
          source?: string
          reason?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_media_credit_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_media_credit_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "paige_media_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_media_jobs: {
        Row: {
          actor_id: string | null
          approval_state: string
          attempts: number
          budget_decision: Json | null
          claimed_at: string | null
          completed_at: string | null
          content_id: string | null
          created_at: string
          error: string | null
          estimated_cost_usd: number | null
          id: string
          idempotency_key: string
          lease_until: string | null
          mode: string
          model: string
          moderation_result: Json | null
          next_poll_at: string | null
          params: Json
          prompt_hash: string | null
          provider: string
          provider_request_id: string | null
          state: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
          actual_cost_usd: number | null
          video_seconds: number | null
        }
        Insert: {
          actor_id?: string | null
          approval_state?: string
          attempts?: number
          budget_decision?: Json | null
          claimed_at?: string | null
          completed_at?: string | null
          content_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          idempotency_key: string
          lease_until?: string | null
          mode: string
          model: string
          moderation_result?: Json | null
          next_poll_at?: string | null
          params?: Json
          prompt_hash?: string | null
          provider: string
          provider_request_id?: string | null
          state?: string
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
          actual_cost_usd?: number | null
          video_seconds?: number | null
        }
        Update: {
          actor_id?: string | null
          approval_state?: string
          attempts?: number
          budget_decision?: Json | null
          claimed_at?: string | null
          completed_at?: string | null
          content_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          idempotency_key?: string
          lease_until?: string | null
          mode?: string
          model?: string
          moderation_result?: Json | null
          next_poll_at?: string | null
          params?: Json
          prompt_hash?: string | null
          provider?: string
          provider_request_id?: string | null
          state?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          actual_cost_usd?: number | null
          video_seconds?: number | null
        }
        Relationships: []
      }
      paige_subagent_factory_quota: {
        Row: {
          created_at: string
          hard_shipped: number
          id: string
          proposals_count: number
          quota_date: string
          soft_shipped: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hard_shipped?: number
          id?: string
          proposals_count?: number
          quota_date?: string
          soft_shipped?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hard_shipped?: number
          id?: string
          proposals_count?: number
          quota_date?: string
          soft_shipped?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_subagent_factory_quota_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_subagent_invocations: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          id: string
          input: Json | null
          invoked_by: string | null
          langgraph_run_id: string | null
          latency_ms: number | null
          output: Json | null
          status: string
          subagent_slug: string
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          invoked_by?: string | null
          langgraph_run_id?: string | null
          latency_ms?: number | null
          output?: Json | null
          status?: string
          subagent_slug: string
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          invoked_by?: string | null
          langgraph_run_id?: string | null
          latency_ms?: number | null
          output?: Json | null
          status?: string
          subagent_slug?: string
        }
        Relationships: []
      }
      paige_subagent_proposals: {
        Row: {
          approval_id: string | null
          config: Json
          created_at: string
          data_scopes: string[]
          description: string
          domain: string
          error: string | null
          id: string
          input_schema: Json
          output_schema: Json
          proposed_by: string | null
          proposed_by_agent: string | null
          proposed_name: string
          proposed_slug: string
          rationale: string
          resulting_subagent_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          runtime: string
          status: string
          system_prompt: string
          tenant_id: string | null
          triggers: string[]
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          config?: Json
          created_at?: string
          data_scopes?: string[]
          description: string
          domain: string
          error?: string | null
          id?: string
          input_schema?: Json
          output_schema?: Json
          proposed_by?: string | null
          proposed_by_agent?: string | null
          proposed_name: string
          proposed_slug: string
          rationale: string
          resulting_subagent_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          runtime: string
          status?: string
          system_prompt: string
          tenant_id?: string | null
          triggers?: string[]
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          config?: Json
          created_at?: string
          data_scopes?: string[]
          description?: string
          domain?: string
          error?: string | null
          id?: string
          input_schema?: Json
          output_schema?: Json
          proposed_by?: string | null
          proposed_by_agent?: string | null
          proposed_name?: string
          proposed_slug?: string
          rationale?: string
          resulting_subagent_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          runtime?: string
          status?: string
          system_prompt?: string
          tenant_id?: string | null
          triggers?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_subagent_proposals_resulting_subagent_id_fkey"
            columns: ["resulting_subagent_id"]
            isOneToOne: false
            referencedRelation: "paige_subagents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_subagent_proposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_subagents: {
        Row: {
          auto_disabled_reason: string | null
          auto_generated: boolean
          config: Json
          created_at: string
          created_by: string | null
          daily_invocation_cap: number | null
          department: string | null
          description: string
          display_order: number
          domain: string
          edge_function: string | null
          enabled: boolean
          id: string
          input_schema: Json
          langgraph_graph: string | null
          monthly_token_cap: number | null
          name: string
          output_schema: Json
          requires_role: string[]
          runtime: string
          slug: string
          system_prompt: string | null
          tenant_id: string | null
          triggers: string[]
          updated_at: string
        }
        Insert: {
          auto_disabled_reason?: string | null
          auto_generated?: boolean
          config?: Json
          created_at?: string
          created_by?: string | null
          daily_invocation_cap?: number | null
          department?: string | null
          description: string
          display_order?: number
          domain: string
          edge_function?: string | null
          enabled?: boolean
          id?: string
          input_schema?: Json
          langgraph_graph?: string | null
          monthly_token_cap?: number | null
          name: string
          output_schema?: Json
          requires_role?: string[]
          runtime: string
          slug: string
          system_prompt?: string | null
          tenant_id?: string | null
          triggers?: string[]
          updated_at?: string
        }
        Update: {
          auto_disabled_reason?: string | null
          auto_generated?: boolean
          config?: Json
          created_at?: string
          created_by?: string | null
          daily_invocation_cap?: number | null
          department?: string | null
          description?: string
          display_order?: number
          domain?: string
          edge_function?: string | null
          enabled?: boolean
          id?: string
          input_schema?: Json
          langgraph_graph?: string | null
          monthly_token_cap?: number | null
          name?: string
          output_schema?: Json
          requires_role?: string[]
          runtime?: string
          slug?: string
          system_prompt?: string | null
          tenant_id?: string | null
          triggers?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_subagents_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "paige_departments"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "paige_subagents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_subscription_events: {
        Row: {
          contact_id: string | null
          created_at: string
          currency: string | null
          event_type: string
          id: string
          mrr_delta_cents: number | null
          processed_at: string | null
          raw: Json | null
          stripe_customer_id: string | null
          stripe_event_id: string
          tier_after: string | null
          tier_before: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          event_type: string
          id?: string
          mrr_delta_cents?: number | null
          processed_at?: string | null
          raw?: Json | null
          stripe_customer_id?: string | null
          stripe_event_id: string
          tier_after?: string | null
          tier_before?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          event_type?: string
          id?: string
          mrr_delta_cents?: number | null
          processed_at?: string | null
          raw?: Json | null
          stripe_customer_id?: string | null
          stripe_event_id?: string
          tier_after?: string | null
          tier_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_subscription_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_subscription_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_subscription_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_subscription_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_telegram_config: {
        Row: {
          bot_token_last4: string | null
          bot_token_ref: string | null
          default_admin_chat_id: string | null
          enabled: boolean
          id: number
          updated_at: string
        }
        Insert: {
          bot_token_last4?: string | null
          bot_token_ref?: string | null
          default_admin_chat_id?: string | null
          enabled?: boolean
          id?: number
          updated_at?: string
        }
        Update: {
          bot_token_last4?: string | null
          bot_token_ref?: string | null
          default_admin_chat_id?: string | null
          enabled?: boolean
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      paige_workflow_registry: {
        Row: {
          allowed_roles: string[]
          category: string
          connection_id: string | null
          created_at: string
          description: string | null
          direct_function_name: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          langgraph_graph_id: string | null
          n8n_webhook_url_ct: string | null
          n8n_workflow_id: string | null
          needs_n8n_link: boolean
          parameters_schema: Json
          provider: Database["public"]["Enums"]["workflow_provider"]
          requires_approval: boolean
          sort_order: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_roles?: string[]
          category: string
          connection_id?: string | null
          created_at?: string
          description?: string | null
          direct_function_name?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          langgraph_graph_id?: string | null
          n8n_webhook_url_ct?: string | null
          n8n_workflow_id?: string | null
          needs_n8n_link?: boolean
          parameters_schema?: Json
          provider?: Database["public"]["Enums"]["workflow_provider"]
          requires_approval?: boolean
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_roles?: string[]
          category?: string
          connection_id?: string | null
          created_at?: string
          description?: string | null
          direct_function_name?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          langgraph_graph_id?: string | null
          n8n_webhook_url_ct?: string | null
          n8n_workflow_id?: string | null
          needs_n8n_link?: boolean
          parameters_schema?: Json
          provider?: Database["public"]["Enums"]["workflow_provider"]
          requires_approval?: boolean
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_workflow_registry_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "paige_n8n_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_workflow_registry_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_workflow_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          langgraph_thread_id: string | null
          last_dispatched_at: string | null
          n8n_execution_id: string | null
          payload: Json
          registry_id: string
          result: Json | null
          retry_count: number
          status: string
          tenant_id: string | null
          triggered_at: string
          triggered_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          langgraph_thread_id?: string | null
          last_dispatched_at?: string | null
          n8n_execution_id?: string | null
          payload?: Json
          registry_id: string
          result?: Json | null
          retry_count?: number
          status?: string
          tenant_id?: string | null
          triggered_at?: string
          triggered_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          langgraph_thread_id?: string | null
          last_dispatched_at?: string | null
          n8n_execution_id?: string | null
          payload?: Json
          registry_id?: string
          result?: Json | null
          retry_count?: number
          status?: string
          tenant_id?: string | null
          triggered_at?: string
          triggered_by_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paige_workflow_runs_registry_id_fkey"
            columns: ["registry_id"]
            isOneToOne: false
            referencedRelation: "paige_workflow_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_workflow_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_access_log: {
        Row: {
          access_type: string
          accessed_at: string | null
          accessed_user_id: string
          accessor_user_id: string
          field_names: string[]
          id: string
          ip_address: unknown
          table_name: string
          user_agent: string | null
        }
        Insert: {
          access_type: string
          accessed_at?: string | null
          accessed_user_id: string
          accessor_user_id: string
          field_names: string[]
          id?: string
          ip_address?: unknown
          table_name: string
          user_agent?: string | null
        }
        Update: {
          access_type?: string
          accessed_at?: string | null
          accessed_user_id?: string
          accessor_user_id?: string
          field_names?: string[]
          id?: string
          ip_address?: unknown
          table_name?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          label: string
          order_index: number
          pipeline_id: string
          probability: number
          stage_type: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          label: string
          order_index?: number
          pipeline_id: string
          probability?: number
          stage_type?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          label?: string
          order_index?: number
          pipeline_id?: string
          probability?: number
          stage_type?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_notifications: {
        Row: {
          channel: string
          id: string
          metadata: Json | null
          sent_at: string | null
          template: string
          user_id: string
        }
        Insert: {
          channel: string
          id?: string
          metadata?: Json | null
          sent_at?: string | null
          template: string
          user_id: string
        }
        Update: {
          channel?: string
          id?: string
          metadata?: Json | null
          sent_at?: string | null
          template?: string
          user_id?: string
        }
        Relationships: []
      }
      plaid_transactions: {
        Row: {
          account_id: string
          amount: number
          category: string[] | null
          created_at: string | null
          date: string
          id: string
          merchant_name: string | null
          name: string | null
          pending: boolean | null
          transaction_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category?: string[] | null
          created_at?: string | null
          date: string
          id?: string
          merchant_name?: string | null
          name?: string | null
          pending?: boolean | null
          transaction_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category?: string[] | null
          created_at?: string | null
          date?: string
          id?: string
          merchant_name?: string | null
          name?: string | null
          pending?: boolean | null
          transaction_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_webhook_events: {
        Row: {
          created_at: string | null
          error: string | null
          event_id: string | null
          id: string
          item_id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          tasks_created: string[] | null
          user_id: string | null
          webhook_code: string
          webhook_type: string
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          item_id: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          tasks_created?: string[] | null
          user_id?: string | null
          webhook_code: string
          webhook_type: string
        }
        Update: {
          created_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          item_id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          tasks_created?: string[] | null
          user_id?: string | null
          webhook_code?: string
          webhook_type?: string
        }
        Relationships: []
      }
      plan_items: {
        Row: {
          assigned_to_user_id: string | null
          campaign_ref: Json | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          item_type: string
          linked_action_id: string | null
          linked_booking_id: string | null
          metadata: Json
          parent_item_id: string | null
          plan_id: string | null
          priority: string
          remind_at: string | null
          remind_channel: string
          remind_target: string
          reminded_at: string | null
          resolved_at: string | null
          status: string
          summary: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          campaign_ref?: Json | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          item_type: string
          linked_action_id?: string | null
          linked_booking_id?: string | null
          metadata?: Json
          parent_item_id?: string | null
          plan_id?: string | null
          priority?: string
          remind_at?: string | null
          remind_channel?: string
          remind_target?: string
          reminded_at?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to_user_id?: string | null
          campaign_ref?: Json | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          item_type?: string
          linked_action_id?: string | null
          linked_booking_id?: string | null
          metadata?: Json
          parent_item_id?: string | null
          plan_id?: string | null
          priority?: string
          remind_at?: string | null
          remind_channel?: string
          remind_target?: string
          reminded_at?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "plan_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "plan_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_linked_action_id_fkey"
            columns: ["linked_action_id"]
            isOneToOne: false
            referencedRelation: "paige_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_linked_booking_id_fkey"
            columns: ["linked_booking_id"]
            isOneToOne: false
            referencedRelation: "internal_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "plan_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          campaign_ref: Json | null
          created_at: string
          created_by: string | null
          ends_on: string
          horizon: string
          id: string
          metadata: Json
          owner_user_id: string | null
          scope: string
          starts_on: string
          status: string
          summary: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          campaign_ref?: Json | null
          created_at?: string
          created_by?: string | null
          ends_on: string
          horizon: string
          id?: string
          metadata?: Json
          owner_user_id?: string | null
          scope?: string
          starts_on: string
          status?: string
          summary?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          campaign_ref?: Json | null
          created_at?: string
          created_by?: string | null
          ends_on?: string
          horizon?: string
          id?: string
          metadata?: Json
          owner_user_id?: string | null
          scope?: string
          starts_on?: string
          status?: string
          summary?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          label: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          label?: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          label?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      platform_email_settings: {
        Row: {
          default_from_name: string
          default_reply_to: string
          id: boolean
          shared_domain: string
          updated_at: string
        }
        Insert: {
          default_from_name?: string
          default_reply_to?: string
          id?: boolean
          shared_domain?: string
          updated_at?: string
        }
        Update: {
          default_from_name?: string
          default_reply_to?: string
          id?: boolean
          shared_domain?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          actor_tier: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          origin_account_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          target_tier: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          actor_tier?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          origin_account_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          target_tier?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          actor_tier?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          origin_account_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          target_tier?: string | null
          token?: string
        }
        Relationships: []
      }
      platform_invoices: {
        Row: {
          created_at: string
          currency: string
          hosted_invoice_url: string | null
          id: string
          invoice_number: string | null
          line_items: Json
          metering_cents: number
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_invoice_id: string | null
          subscription_id: string | null
          subtotal_cents: number
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          invoice_number?: string | null
          line_items?: Json
          metering_cents?: number
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string | null
          subscription_id?: string | null
          subtotal_cents?: number
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          invoice_number?: string | null
          line_items?: Json
          metering_cents?: number
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string | null
          subscription_id?: string | null
          subtotal_cents?: number
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "platform_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_legal_profile: {
        Row: {
          created_at: string
          entity_type: string | null
          governing_law_state: string
          id: string
          legal_entity_name: string
          product_name: string
          registered_address: string | null
          singleton: boolean
          state_of_formation: string | null
          support_email: string
          support_phone: string | null
          updated_at: string
          website_url: string
        }
        Insert: {
          created_at?: string
          entity_type?: string | null
          governing_law_state?: string
          id?: string
          legal_entity_name?: string
          product_name?: string
          registered_address?: string | null
          singleton?: boolean
          state_of_formation?: string | null
          support_email?: string
          support_phone?: string | null
          updated_at?: string
          website_url?: string
        }
        Update: {
          created_at?: string
          entity_type?: string | null
          governing_law_state?: string
          id?: string
          legal_entity_name?: string
          product_name?: string
          registered_address?: string | null
          singleton?: boolean
          state_of_formation?: string | null
          support_email?: string
          support_phone?: string | null
          updated_at?: string
          website_url?: string
        }
        Relationships: []
      }
      platform_metered_events: {
        Row: {
          created_at: string
          end_customer_contact_id: string | null
          end_customer_user_id: string | null
          event_type: string
          id: string
          idempotency_key: string
          layer: string
          metadata: Json
          occurred_at: string
          provider: string | null
          quantity: number
          reconciliation_id: string | null
          service_category: string
          subject_id: string
          subject_type: string
          tenant_billing_method: string | null
          tenant_id: string | null
          tenant_retail_charge_usd: number | null
          wholesale_cost_usd: number
        }
        Insert: {
          created_at?: string
          end_customer_contact_id?: string | null
          end_customer_user_id?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          layer: string
          metadata?: Json
          occurred_at?: string
          provider?: string | null
          quantity?: number
          reconciliation_id?: string | null
          service_category: string
          subject_id: string
          subject_type: string
          tenant_billing_method?: string | null
          tenant_id?: string | null
          tenant_retail_charge_usd?: number | null
          wholesale_cost_usd?: number
        }
        Update: {
          created_at?: string
          end_customer_contact_id?: string | null
          end_customer_user_id?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          layer?: string
          metadata?: Json
          occurred_at?: string
          provider?: string | null
          quantity?: number
          reconciliation_id?: string | null
          service_category?: string
          subject_id?: string
          subject_type?: string
          tenant_billing_method?: string | null
          tenant_id?: string | null
          tenant_retail_charge_usd?: number | null
          wholesale_cost_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_metered_events_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_metered_events_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "platform_metered_events_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "platform_metered_events_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_metered_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_metered_events_dead_letter: {
        Row: {
          attempt_count: number
          created_at: string
          error_class: string | null
          error_message: string | null
          event_type: string
          first_failed_at: string
          id: string
          idempotency_key: string
          last_failed_at: string
          layer: string | null
          next_retry_at: string
          payload: Json
          quantity: number
          resolved_at: string | null
          status: string
          subject_id: string | null
          subject_type: string | null
          tenant_id: string | null
          unit_amount_cents: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_class?: string | null
          error_message?: string | null
          event_type: string
          first_failed_at?: string
          id?: string
          idempotency_key: string
          last_failed_at?: string
          layer?: string | null
          next_retry_at?: string
          payload?: Json
          quantity?: number
          resolved_at?: string | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tenant_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_class?: string | null
          error_message?: string | null
          event_type?: string
          first_failed_at?: string
          id?: string
          idempotency_key?: string
          last_failed_at?: string
          layer?: string | null
          next_retry_at?: string
          payload?: Json
          quantity?: number
          resolved_at?: string | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tenant_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      platform_metering_reconciliation: {
        Row: {
          created_at: string
          event_count: number
          id: string
          invoice_id: string | null
          period_end: string
          period_start: string
          service_category: string
          status: string
          tenant_id: string
          total_wholesale_cost_usd: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_count?: number
          id?: string
          invoice_id?: string | null
          period_end: string
          period_start: string
          service_category: string
          status?: string
          tenant_id: string
          total_wholesale_cost_usd?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_count?: number
          id?: string
          invoice_id?: string | null
          period_end?: string
          period_start?: string
          service_category?: string
          status?: string
          tenant_id?: string
          total_wholesale_cost_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_metering_reconciliation_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "platform_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_metering_reconciliation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_subscription_plans: {
        Row: {
          annual_price_cents: number | null
          created_at: string
          description: string | null
          id: string
          included_contacts: number | null
          included_seats: number
          is_active: boolean
          metered_addons: Json
          monthly_price_cents: number
          name: string
          slug: string
          stripe_price_id: string | null
          updated_at: string
        }
        Insert: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          included_contacts?: number | null
          included_seats?: number
          is_active?: boolean
          metered_addons?: Json
          monthly_price_cents?: number
          name: string
          slug: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Update: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          included_contacts?: number | null
          included_seats?: number
          is_active?: boolean
          metered_addons?: Json
          monthly_price_cents?: number
          name?: string
          slug?: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_subscriptions: {
        Row: {
          billing_period: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_period?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_period?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          quantity: number
          reconciled_invoice_id: string | null
          tenant_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number
          reconciled_invoice_id?: string | null
          tenant_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number
          reconciled_invoice_id?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_usage_events_reconciled_invoice_id_fkey"
            columns: ["reconciled_invoice_id"]
            isOneToOne: false
            referencedRelation: "platform_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_tenant_id: string | null
          address: string | null
          agency_login_default: string
          avatar_url: string | null
          biggest_obstacle: string | null
          business_name: string | null
          city: string | null
          coach_accepting_clients: boolean
          coach_bio: string | null
          coach_capacity: number | null
          coach_specialties: string[]
          coach_timezone: string | null
          consent_data_usage: boolean
          consent_marketing: boolean
          consent_privacy_policy: boolean
          consent_timestamp: string | null
          created_at: string | null
          credit_goals: Json | null
          credit_report_consent: boolean
          credit_report_consent_timestamp: string | null
          cross_bureau_discrepancies: Json | null
          dashboard_mode: string
          date_of_birth: string | null
          dob_last4: string | null
          estimated_fico_eq: number | null
          estimated_fico_ex: number | null
          estimated_fico_tu: number | null
          ethnicity: string[] | null
          experience_level: string | null
          financing_preference: string | null
          first_name: string | null
          full_name: string | null
          funding_goals: Json | null
          gender_identity: string | null
          ghl_contact_id: string | null
          goal_amount: number | null
          goal_timeline: string | null
          has_broker_access: boolean
          has_discrepancies: boolean | null
          has_equipment_assets: boolean
          has_investment_accounts: boolean
          has_invoice_receivables: boolean
          has_real_estate_equity: boolean
          id: string
          intake_completed: boolean
          intake_completed_at: string | null
          intake_responses: Json | null
          investment_account_value_range: string | null
          is_complimentary: boolean
          is_permanent_resident: boolean | null
          is_service_disabled_veteran: boolean | null
          is_us_citizen: boolean | null
          is_veteran: boolean | null
          last_fundability_calculated: string | null
          last_fundability_snapshot: Json | null
          last_name: string | null
          last_report_analyzed_at: string | null
          last_report_source: string | null
          middle_initial: string | null
          monthly_revenue_range: string | null
          onboarding_completed: boolean | null
          onboarding_step: string | null
          phone: string | null
          pme_phase: string | null
          postal_code: string | null
          primary_bank_average_balance: number | null
          primary_bank_months: number | null
          primary_bank_name: string | null
          primary_goal: string | null
          primary_goal_category: string | null
          real_estate_equity_range: string | null
          referral_code: string | null
          score_model: string | null
          signup_completed_at: string | null
          signup_lane: string | null
          signup_started_at: string | null
          ssn_encrypted: string | null
          ssn_last_4: string | null
          staff_notes: string | null
          state: string | null
          stripe_customer_id: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspended_reason: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          total_liquid_assets_range: string | null
          updated_at: string | null
          user_id: string
          website_url: string | null
          work_email: string | null
        }
        Insert: {
          active_tenant_id?: string | null
          address?: string | null
          agency_login_default?: string
          avatar_url?: string | null
          biggest_obstacle?: string | null
          business_name?: string | null
          city?: string | null
          coach_accepting_clients?: boolean
          coach_bio?: string | null
          coach_capacity?: number | null
          coach_specialties?: string[]
          coach_timezone?: string | null
          consent_data_usage?: boolean
          consent_marketing?: boolean
          consent_privacy_policy?: boolean
          consent_timestamp?: string | null
          created_at?: string | null
          credit_goals?: Json | null
          credit_report_consent?: boolean
          credit_report_consent_timestamp?: string | null
          cross_bureau_discrepancies?: Json | null
          dashboard_mode?: string
          date_of_birth?: string | null
          dob_last4?: string | null
          estimated_fico_eq?: number | null
          estimated_fico_ex?: number | null
          estimated_fico_tu?: number | null
          ethnicity?: string[] | null
          experience_level?: string | null
          financing_preference?: string | null
          first_name?: string | null
          full_name?: string | null
          funding_goals?: Json | null
          gender_identity?: string | null
          ghl_contact_id?: string | null
          goal_amount?: number | null
          goal_timeline?: string | null
          has_broker_access?: boolean
          has_discrepancies?: boolean | null
          has_equipment_assets?: boolean
          has_investment_accounts?: boolean
          has_invoice_receivables?: boolean
          has_real_estate_equity?: boolean
          id?: string
          intake_completed?: boolean
          intake_completed_at?: string | null
          intake_responses?: Json | null
          investment_account_value_range?: string | null
          is_complimentary?: boolean
          is_permanent_resident?: boolean | null
          is_service_disabled_veteran?: boolean | null
          is_us_citizen?: boolean | null
          is_veteran?: boolean | null
          last_fundability_calculated?: string | null
          last_fundability_snapshot?: Json | null
          last_name?: string | null
          last_report_analyzed_at?: string | null
          last_report_source?: string | null
          middle_initial?: string | null
          monthly_revenue_range?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          phone?: string | null
          pme_phase?: string | null
          postal_code?: string | null
          primary_bank_average_balance?: number | null
          primary_bank_months?: number | null
          primary_bank_name?: string | null
          primary_goal?: string | null
          primary_goal_category?: string | null
          real_estate_equity_range?: string | null
          referral_code?: string | null
          score_model?: string | null
          signup_completed_at?: string | null
          signup_lane?: string | null
          signup_started_at?: string | null
          ssn_encrypted?: string | null
          ssn_last_4?: string | null
          staff_notes?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          total_liquid_assets_range?: string | null
          updated_at?: string | null
          user_id: string
          website_url?: string | null
          work_email?: string | null
        }
        Update: {
          active_tenant_id?: string | null
          address?: string | null
          agency_login_default?: string
          avatar_url?: string | null
          biggest_obstacle?: string | null
          business_name?: string | null
          city?: string | null
          coach_accepting_clients?: boolean
          coach_bio?: string | null
          coach_capacity?: number | null
          coach_specialties?: string[]
          coach_timezone?: string | null
          consent_data_usage?: boolean
          consent_marketing?: boolean
          consent_privacy_policy?: boolean
          consent_timestamp?: string | null
          created_at?: string | null
          credit_goals?: Json | null
          credit_report_consent?: boolean
          credit_report_consent_timestamp?: string | null
          cross_bureau_discrepancies?: Json | null
          dashboard_mode?: string
          date_of_birth?: string | null
          dob_last4?: string | null
          estimated_fico_eq?: number | null
          estimated_fico_ex?: number | null
          estimated_fico_tu?: number | null
          ethnicity?: string[] | null
          experience_level?: string | null
          financing_preference?: string | null
          first_name?: string | null
          full_name?: string | null
          funding_goals?: Json | null
          gender_identity?: string | null
          ghl_contact_id?: string | null
          goal_amount?: number | null
          goal_timeline?: string | null
          has_broker_access?: boolean
          has_discrepancies?: boolean | null
          has_equipment_assets?: boolean
          has_investment_accounts?: boolean
          has_invoice_receivables?: boolean
          has_real_estate_equity?: boolean
          id?: string
          intake_completed?: boolean
          intake_completed_at?: string | null
          intake_responses?: Json | null
          investment_account_value_range?: string | null
          is_complimentary?: boolean
          is_permanent_resident?: boolean | null
          is_service_disabled_veteran?: boolean | null
          is_us_citizen?: boolean | null
          is_veteran?: boolean | null
          last_fundability_calculated?: string | null
          last_fundability_snapshot?: Json | null
          last_name?: string | null
          last_report_analyzed_at?: string | null
          last_report_source?: string | null
          middle_initial?: string | null
          monthly_revenue_range?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          phone?: string | null
          pme_phase?: string | null
          postal_code?: string | null
          primary_bank_average_balance?: number | null
          primary_bank_months?: number | null
          primary_bank_name?: string | null
          primary_goal?: string | null
          primary_goal_category?: string | null
          real_estate_equity_range?: string | null
          referral_code?: string | null
          score_model?: string | null
          signup_completed_at?: string | null
          signup_lane?: string | null
          signup_started_at?: string | null
          ssn_encrypted?: string | null
          ssn_last_4?: string | null
          staff_notes?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          total_liquid_assets_range?: string | null
          updated_at?: string | null
          user_id?: string
          website_url?: string | null
          work_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_tenant_id_fkey"
            columns: ["active_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      program_approvals: {
        Row: {
          approval_type: string
          approved_at: string | null
          approved_by: string | null
          client_id: string
          created_at: string
          enrollment_id: string
          id: string
          metadata: Json
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approval_type: string
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          metadata?: Json
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approval_type?: string
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          metadata?: Json
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_approvals_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "program_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      program_document_requests: {
        Row: {
          client_id: string
          created_at: string
          description: string | null
          document_id: string | null
          enrollment_id: string
          fulfilled_at: string | null
          id: string
          metadata: Json
          requested_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string | null
          document_id?: string | null
          enrollment_id: string
          fulfilled_at?: string | null
          id?: string
          metadata?: Json
          requested_at?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string | null
          document_id?: string | null
          enrollment_id?: string
          fulfilled_at?: string | null
          id?: string
          metadata?: Json
          requested_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_document_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_document_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_document_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_document_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_document_requests_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_document_requests_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "program_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      program_enrollments: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          enrolled_at: string
          id: string
          metadata: Json
          program_id: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          metadata?: Json
          program_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          metadata?: Json
          program_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_enrollments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_messages: {
        Row: {
          body: string
          client_id: string
          created_at: string
          enrollment_id: string
          id: string
          metadata: Json
          sender_type: string
          sender_user_id: string | null
          updated_at: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          metadata?: Json
          sender_type: string
          sender_user_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          metadata?: Json
          sender_type?: string
          sender_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_messages_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "program_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phase_item_states: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          enrollment_id: string
          id: string
          metadata: Json
          phase_item_id: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          enrollment_id: string
          id?: string
          metadata?: Json
          phase_item_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          enrollment_id?: string
          id?: string
          metadata?: Json
          phase_item_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_phase_item_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_phase_item_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_phase_item_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "program_phase_item_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_phase_item_states_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "program_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_phase_item_states_phase_item_id_fkey"
            columns: ["phase_item_id"]
            isOneToOne: false
            referencedRelation: "program_phase_items"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phase_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          item_type: string
          metadata: Json
          phase_id: string
          required: boolean
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          item_type?: string
          metadata?: Json
          phase_id: string
          required?: boolean
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          item_type?: string
          metadata?: Json
          phase_id?: string
          required?: boolean
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_phase_items_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phases: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          name: string
          program_id: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          program_id: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          program_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_phases_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          metadata: Json
          name: string
          slug: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          slug: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          slug?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_rate_limits: {
        Row: {
          bucket: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      push_notification_log: {
        Row: {
          body: string
          category: string
          created_at: string
          data: Json | null
          error_message: string | null
          id: string
          sent_at: string | null
          status: string
          subscription_id: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          data?: Json | null
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          data?: Json | null
          error_message?: string | null
          id?: string
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_preferences: {
        Row: {
          created_at: string
          id: string
          notify_credit_score_changes: boolean
          notify_dispute_updates: boolean
          notify_funding_matches: boolean
          notify_task_reminders: boolean
          prompt_dismiss_count: number
          prompt_dismissed_at: string | null
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notify_credit_score_changes?: boolean
          notify_dispute_updates?: boolean
          notify_funding_matches?: boolean
          notify_task_reminders?: boolean
          prompt_dismiss_count?: number
          prompt_dismissed_at?: string | null
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notify_credit_score_changes?: boolean
          notify_dispute_updates?: boolean
          notify_funding_matches?: boolean
          notify_task_reminders?: boolean
          prompt_dismiss_count?: number
          prompt_dismissed_at?: string | null
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          device_type: string | null
          endpoint: string
          id: string
          is_active: boolean
          last_used_at: string
          p256dh_key: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          device_type?: string | null
          endpoint: string
          id?: string
          is_active?: boolean
          last_used_at?: string
          p256dh_key: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          device_type?: string | null
          endpoint?: string
          id?: string
          is_active?: boolean
          last_used_at?: string
          p256dh_key?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      quickbooks_connections: {
        Row: {
          access_token_encrypted: string
          business_id: string | null
          created_at: string
          environment: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          last_webhook_received_at: string | null
          needs_expense_sync: boolean
          needs_revenue_sync: boolean
          qb_company_name: string | null
          qb_realm_id: string
          refresh_token_encrypted: string
          scope: string | null
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          business_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          last_webhook_received_at?: string | null
          needs_expense_sync?: boolean
          needs_revenue_sync?: boolean
          qb_company_name?: string | null
          qb_realm_id: string
          refresh_token_encrypted: string
          scope?: string | null
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          business_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          last_webhook_received_at?: string | null
          needs_expense_sync?: boolean
          needs_revenue_sync?: boolean
          qb_company_name?: string | null
          qb_realm_id?: string
          refresh_token_encrypted?: string
          scope?: string | null
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_financials: {
        Row: {
          accounts_payable: number | null
          accounts_receivable: number | null
          business_id: string | null
          cash_and_bank_balance: number | null
          cash_runway_months: number | null
          cogs: number | null
          created_at: string
          gross_margin_percent: number | null
          gross_profit: number | null
          id: string
          marketing_expenses: number | null
          monthly_burn_rate: number | null
          net_income: number | null
          net_margin_percent: number | null
          operating_expenses: number | null
          payroll_expenses: number | null
          period_end: string
          period_start: string
          professional_fees: number | null
          qb_connection_id: string
          revenue_per_month: Json | null
          synced_at: string
          top_expense_categories: Json | null
          total_expenses: number | null
          total_revenue: number | null
          user_id: string
        }
        Insert: {
          accounts_payable?: number | null
          accounts_receivable?: number | null
          business_id?: string | null
          cash_and_bank_balance?: number | null
          cash_runway_months?: number | null
          cogs?: number | null
          created_at?: string
          gross_margin_percent?: number | null
          gross_profit?: number | null
          id?: string
          marketing_expenses?: number | null
          monthly_burn_rate?: number | null
          net_income?: number | null
          net_margin_percent?: number | null
          operating_expenses?: number | null
          payroll_expenses?: number | null
          period_end: string
          period_start: string
          professional_fees?: number | null
          qb_connection_id: string
          revenue_per_month?: Json | null
          synced_at?: string
          top_expense_categories?: Json | null
          total_expenses?: number | null
          total_revenue?: number | null
          user_id: string
        }
        Update: {
          accounts_payable?: number | null
          accounts_receivable?: number | null
          business_id?: string | null
          cash_and_bank_balance?: number | null
          cash_runway_months?: number | null
          cogs?: number | null
          created_at?: string
          gross_margin_percent?: number | null
          gross_profit?: number | null
          id?: string
          marketing_expenses?: number | null
          monthly_burn_rate?: number | null
          net_income?: number | null
          net_margin_percent?: number | null
          operating_expenses?: number | null
          payroll_expenses?: number | null
          period_end?: string
          period_start?: string
          professional_fees?: number | null
          qb_connection_id?: string
          revenue_per_month?: Json | null
          synced_at?: string
          top_expense_categories?: Json | null
          total_expenses?: number | null
          total_revenue?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_financials_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quickbooks_financials_qb_connection_id_fkey"
            columns: ["qb_connection_id"]
            isOneToOne: false
            referencedRelation: "quickbooks_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_transactions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_business_expense: boolean | null
          qb_connection_id: string
          qb_transaction_id: string
          transaction_date: string
          transaction_type: string
          user_id: string
          vendor_or_customer: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_business_expense?: boolean | null
          qb_connection_id: string
          qb_transaction_id: string
          transaction_date: string
          transaction_type: string
          user_id: string
          vendor_or_customer?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_business_expense?: boolean | null
          qb_connection_id?: string
          qb_transaction_id?: string
          transaction_date?: string
          transaction_type?: string
          user_id?: string
          vendor_or_customer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_transactions_qb_connection_id_fkey"
            columns: ["qb_connection_id"]
            isOneToOne: false
            referencedRelation: "quickbooks_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_documents: {
        Row: {
          client_id: string | null
          content: string
          created_at: string
          document_type: string
          embedding: string | null
          helpful_count: number
          id: string
          is_anonymized: boolean
          is_published: boolean
          metadata: Json
          quality_score: number
          source: string
          summary: string | null
          title: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          client_id?: string | null
          content: string
          created_at?: string
          document_type: string
          embedding?: string | null
          helpful_count?: number
          id?: string
          is_anonymized?: boolean
          is_published?: boolean
          metadata?: Json
          quality_score?: number
          source?: string
          summary?: string | null
          title: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          client_id?: string | null
          content?: string
          created_at?: string
          document_type?: string
          embedding?: string | null
          helpful_count?: number
          id?: string
          is_anonymized?: boolean
          is_published?: boolean
          metadata?: Json
          quality_score?: number
          source?: string
          summary?: string | null
          title?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "rag_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "coach_client_profiles_safe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rag_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      rag_retrieval_log: {
        Row: {
          created_at: string
          id: string
          query_embedding: string | null
          query_text: string | null
          retrieved_document_ids: string[]
          user_id: string | null
          was_helpful: boolean | null
        }
        Insert: {
          created_at?: string
          id?: string
          query_embedding?: string | null
          query_text?: string | null
          retrieved_document_ids?: string[]
          user_id?: string | null
          was_helpful?: boolean | null
        }
        Update: {
          created_at?: string
          id?: string
          query_embedding?: string | null
          query_text?: string | null
          retrieved_document_ids?: string[]
          user_id?: string | null
          was_helpful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_retrieval_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "coach_client_profiles_safe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rag_retrieval_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      referral_clicks: {
        Row: {
          affiliate_id: string | null
          clicked_at: string
          country: string | null
          id: number
          ip_hash: string | null
          landing_path: string | null
          referral_code: string
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          affiliate_id?: string | null
          clicked_at?: string
          country?: string | null
          id?: number
          ip_hash?: string | null
          landing_path?: string | null
          referral_code: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          affiliate_id?: string | null
          clicked_at?: string
          country?: string | null
          id?: number
          ip_hash?: string | null
          landing_path?: string | null
          referral_code?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "v_affiliate_stats"
            referencedColumns: ["affiliate_id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          active: boolean
          affiliate_id: string
          code: string
          created_at: string
        }
        Insert: {
          active?: boolean
          affiliate_id: string
          code: string
          created_at?: string
        }
        Update: {
          active?: boolean
          affiliate_id?: string
          code?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_codes_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "v_affiliate_stats"
            referencedColumns: ["affiliate_id"]
          },
        ]
      }
      referral_conversions: {
        Row: {
          affiliate_id: string
          amount_cents: number
          commission_cents: number
          converted_at: string
          id: string
          referral_code: string
          referred_user_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
        }
        Insert: {
          affiliate_id: string
          amount_cents?: number
          commission_cents?: number
          converted_at?: string
          id?: string
          referral_code: string
          referred_user_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Update: {
          affiliate_id?: string
          amount_cents?: number
          commission_cents?: number
          converted_at?: string
          id?: string
          referral_code?: string
          referred_user_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_conversions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_conversions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "v_affiliate_stats"
            referencedColumns: ["affiliate_id"]
          },
        ]
      }
      research_runs: {
        Row: {
          caller: string
          client_user_id: string | null
          configured: boolean
          coverage: Json
          created_at: string
          domain: string
          entity_profile: Json | null
          findings: Json
          id: string
          question: string
          stop_reason: string | null
          user_id: string
        }
        Insert: {
          caller?: string
          client_user_id?: string | null
          configured?: boolean
          coverage?: Json
          created_at?: string
          domain?: string
          entity_profile?: Json | null
          findings?: Json
          id?: string
          question: string
          stop_reason?: string | null
          user_id: string
        }
        Update: {
          caller?: string
          client_user_id?: string | null
          configured?: boolean
          coverage?: Json
          created_at?: string
          domain?: string
          entity_profile?: Json | null
          findings?: Json
          id?: string
          question?: string
          stop_reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      research_sources: {
        Row: {
          excluded: boolean
          fetched_at: string
          id: string
          published_at: string | null
          reliability: string | null
          reliability_score: number
          run_id: string
          snippet: string | null
          source_index: number
          tier: string | null
          title: string | null
          url: string
          user_id: string
        }
        Insert: {
          excluded?: boolean
          fetched_at?: string
          id?: string
          published_at?: string | null
          reliability?: string | null
          reliability_score?: number
          run_id: string
          snippet?: string | null
          source_index: number
          tier?: string | null
          title?: string | null
          url: string
          user_id: string
        }
        Update: {
          excluded?: boolean
          fetched_at?: string
          id?: string
          published_at?: string | null
          reliability?: string | null
          reliability_score?: number
          run_id?: string
          snippet?: string | null
          source_index?: number
          tier?: string | null
          title?: string | null
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_sources_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      response_quality_feedback: {
        Row: {
          correction_note: string | null
          created_at: string
          id: string
          message_content: string | null
          message_id: string
          rated_by: string
          rating: string
          reason_category: string | null
          reason_other: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string
        }
        Insert: {
          correction_note?: string | null
          created_at?: string
          id?: string
          message_content?: string | null
          message_id: string
          rated_by: string
          rating: string
          reason_category?: string | null
          reason_other?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id: string
        }
        Update: {
          correction_note?: string | null
          created_at?: string
          id?: string
          message_content?: string | null
          message_id?: string
          rated_by?: string
          rating?: string
          reason_category?: string | null
          reason_other?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string
        }
        Relationships: []
      }
      security_canary_runs: {
        Row: {
          created_at: string
          error_message: string | null
          http_status: number | null
          id: string
          leaked_columns: string[]
          probe_name: string
          sample_payload: Json | null
          status: string
          target: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          leaked_columns?: string[]
          probe_name: string
          sample_payload?: Json | null
          status: string
          target: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          leaked_columns?: string[]
          probe_name?: string
          sample_payload?: Json | null
          status?: string
          target?: string
        }
        Relationships: []
      }
      sms_verifications: {
        Row: {
          attempts: number
          code_hashed: boolean
          created_at: string
          expires_at: string
          id: string
          phone_number: string
          user_id: string
          verification_code: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hashed?: boolean
          created_at?: string
          expires_at: string
          id?: string
          phone_number: string
          user_id: string
          verification_code: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hashed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          phone_number?: string
          user_id?: string
          verification_code?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      staff_calendar_settings: {
        Row: {
          apple_app_password_encrypted: string | null
          apple_caldav_connected: boolean
          apple_caldav_url: string | null
          apple_caldav_username: string | null
          apple_last_sync_at: string | null
          availability_json: Json
          booking_page_accent: string | null
          booking_page_description: string | null
          booking_page_enabled: boolean
          booking_page_slug: string | null
          booking_page_title: string | null
          buffer_after_min: number
          buffer_before_min: number
          created_at: string
          default_meeting_duration_min: number
          google_calendar_connected: boolean
          google_calendar_id: string | null
          google_email: string | null
          google_last_sync_at: string | null
          google_refresh_token_encrypted: string | null
          google_sync_token: string | null
          id: string
          tenant_id: string | null
          timezone: string
          updated_at: string
          user_id: string
          zoom_access_token_encrypted: string | null
          zoom_connected: boolean
          zoom_email: string | null
          zoom_refresh_token_encrypted: string | null
          zoom_token_expires_at: string | null
          zoom_user_id: string | null
        }
        Insert: {
          apple_app_password_encrypted?: string | null
          apple_caldav_connected?: boolean
          apple_caldav_url?: string | null
          apple_caldav_username?: string | null
          apple_last_sync_at?: string | null
          availability_json?: Json
          booking_page_accent?: string | null
          booking_page_description?: string | null
          booking_page_enabled?: boolean
          booking_page_slug?: string | null
          booking_page_title?: string | null
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          default_meeting_duration_min?: number
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_email?: string | null
          google_last_sync_at?: string | null
          google_refresh_token_encrypted?: string | null
          google_sync_token?: string | null
          id?: string
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
          zoom_access_token_encrypted?: string | null
          zoom_connected?: boolean
          zoom_email?: string | null
          zoom_refresh_token_encrypted?: string | null
          zoom_token_expires_at?: string | null
          zoom_user_id?: string | null
        }
        Update: {
          apple_app_password_encrypted?: string | null
          apple_caldav_connected?: boolean
          apple_caldav_url?: string | null
          apple_caldav_username?: string | null
          apple_last_sync_at?: string | null
          availability_json?: Json
          booking_page_accent?: string | null
          booking_page_description?: string | null
          booking_page_enabled?: boolean
          booking_page_slug?: string | null
          booking_page_title?: string | null
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          default_meeting_duration_min?: number
          google_calendar_connected?: boolean
          google_calendar_id?: string | null
          google_email?: string | null
          google_last_sync_at?: string | null
          google_refresh_token_encrypted?: string | null
          google_sync_token?: string | null
          id?: string
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
          zoom_access_token_encrypted?: string | null
          zoom_connected?: boolean
          zoom_email?: string | null
          zoom_refresh_token_encrypted?: string | null
          zoom_token_expires_at?: string | null
          zoom_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_calendar_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_automation_events: {
        Row: {
          contact_id: string | null
          created_at: string
          deal_id: string | null
          dispatched_at: string | null
          error: string | null
          from_stage_id: string | null
          id: string
          rule_id: string | null
          status: string
          tenant_id: string
          to_stage_id: string | null
          webhook_response: Json | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          dispatched_at?: string | null
          error?: string | null
          from_stage_id?: string | null
          id?: string
          rule_id?: string | null
          status: string
          tenant_id: string
          to_stage_id?: string | null
          webhook_response?: Json | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          dispatched_at?: string | null
          error?: string | null
          from_stage_id?: string | null
          id?: string
          rule_id?: string | null
          status?: string
          tenant_id?: string
          to_stage_id?: string | null
          webhook_response?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_automation_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "stage_automation_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "stage_automation_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "stage_automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_automation_rules: {
        Row: {
          compose_intent: string
          created_at: string
          created_by: string | null
          from_stage_id: string | null
          id: string
          is_active: boolean
          pipeline_id: string
          send_mode: string
          template_hint: string | null
          tenant_id: string
          to_stage_id: string
          tone: string
          updated_at: string
        }
        Insert: {
          compose_intent: string
          created_at?: string
          created_by?: string | null
          from_stage_id?: string | null
          id?: string
          is_active?: boolean
          pipeline_id: string
          send_mode?: string
          template_hint?: string | null
          tenant_id: string
          to_stage_id: string
          tone?: string
          updated_at?: string
        }
        Update: {
          compose_intent?: string
          created_at?: string
          created_by?: string | null
          from_stage_id?: string | null
          id?: string
          is_active?: boolean
          pipeline_id?: string
          send_mode?: string
          template_hint?: string | null
          tenant_id?: string
          to_stage_id?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_automation_rules_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_rules_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automation_rules_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_log: {
        Row: {
          account_id: string | null
          event_id: string
          livemode: boolean | null
          metadata: Json
          payload_digest: string | null
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          account_id?: string | null
          event_id: string
          livemode?: boolean | null
          metadata?: Json
          payload_digest?: string | null
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          account_id?: string | null
          event_id?: string
          livemode?: boolean | null
          metadata?: Json
          payload_digest?: string | null
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      stripe_product_mappings: {
        Row: {
          created_at: string
          environment: string
          is_active: boolean
          plan_slug: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          environment?: string
          is_active?: boolean
          plan_slug: string
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          environment?: string
          is_active?: boolean
          plan_slug?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          ai_chat_limit: number | null
          created_at: string | null
          dispute_limit: number | null
          features: Json
          has_business_credit: boolean | null
          has_business_document_upload: boolean
          has_document_upload: boolean
          has_funding_tools: boolean | null
          has_personal_document_upload: boolean
          id: string
          name: string
          price: number
          slug: string
          updated_at: string | null
        }
        Insert: {
          ai_chat_limit?: number | null
          created_at?: string | null
          dispute_limit?: number | null
          features?: Json
          has_business_credit?: boolean | null
          has_business_document_upload?: boolean
          has_document_upload?: boolean
          has_funding_tools?: boolean | null
          has_personal_document_upload?: boolean
          id?: string
          name: string
          price: number
          slug: string
          updated_at?: string | null
        }
        Update: {
          ai_chat_limit?: number | null
          created_at?: string | null
          dispute_limit?: number | null
          features?: Json
          has_business_credit?: boolean | null
          has_business_document_upload?: boolean
          has_document_upload?: boolean
          has_funding_tools?: boolean | null
          has_personal_document_upload?: boolean
          id?: string
          name?: string
          price?: number
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      support_ticket_last_seen: {
        Row: {
          last_seen_at: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          ticket_id: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_last_seen_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          created_at: string
          id: string
          is_internal: boolean
          message: string
          sender_type: string
          ticket_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_internal?: boolean
          message: string
          sender_type: string
          ticket_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_internal?: boolean
          message?: string
          sender_type?: string
          ticket_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string
          id: string
          priority: string
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          subject: string
          ticket_number: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          subject: string
          ticket_number?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          biz_id: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          reminder_sent: boolean
          status: Database["public"]["Enums"]["task_status"]
          tenant_id: string | null
          title: string
          track: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          biz_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          reminder_sent?: boolean
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id?: string | null
          title: string
          track?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          biz_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          reminder_sent?: boolean
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id?: string | null
          title?: string
          track?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_biz_id_fkey"
            columns: ["biz_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_account_number_seq: {
        Row: {
          last_value: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_account_number_seq_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_agreement_versions: {
        Row: {
          base_template_id: string | null
          body_markdown: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          rendered_sha256: string | null
          source_mode: string
          template_slug: string
          tenant_id: string
          title: string
          updated_at: string
          uploaded_file_mime: string | null
          uploaded_file_path: string | null
          version: number
        }
        Insert: {
          base_template_id?: string | null
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          rendered_sha256?: string | null
          source_mode: string
          template_slug: string
          tenant_id: string
          title: string
          updated_at?: string
          uploaded_file_mime?: string | null
          uploaded_file_path?: string | null
          version?: number
        }
        Update: {
          base_template_id?: string | null
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          rendered_sha256?: string | null
          source_mode?: string
          template_slug?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          uploaded_file_mime?: string | null
          uploaded_file_path?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_agreement_versions_base_template_id_fkey"
            columns: ["base_template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_agreement_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_delegations: {
        Row: {
          created_at: string
          from_tenant_id: string
          granted_at: string
          granted_by: string | null
          id: string
          metadata: Json
          revoked_at: string | null
          scope: Json
          status: string
          to_tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_tenant_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          revoked_at?: string | null
          scope: Json
          status?: string
          to_tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_tenant_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          revoked_at?: string | null
          scope?: Json
          status?: string
          to_tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_delegations_from_tenant_id_fkey"
            columns: ["from_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_delegations_to_tenant_id_fkey"
            columns: ["to_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_email_domains: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          dns_records: Json
          domain: string
          from_email_local: string
          from_name: string
          id: string
          is_default: boolean
          resend_domain_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          dns_records?: Json
          domain: string
          from_email_local?: string
          from_name: string
          id?: string
          is_default?: boolean
          resend_domain_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          dns_records?: Json
          domain?: string
          from_email_local?: string
          from_name?: string
          id?: string
          is_default?: boolean
          resend_domain_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_email_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_email_identities: {
        Row: {
          custom_domain_id: string | null
          from_name: string
          kind: string
          local_part: string
          provisioned_at: string
          reply_to: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          custom_domain_id?: string | null
          from_name: string
          kind?: string
          local_part: string
          provisioned_at?: string
          reply_to?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          custom_domain_id?: string | null
          from_name?: string
          kind?: string
          local_part?: string
          provisioned_at?: string
          reply_to?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_email_identities_custom_domain_id_fkey"
            columns: ["custom_domain_id"]
            isOneToOne: false
            referencedRelation: "tenant_email_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_email_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_entity_relationships: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          entity_id: string
          id: string
          metadata: Json
          relationship_type: string
          started_at: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          entity_id: string
          id?: string
          metadata?: Json
          relationship_type: string
          started_at?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          entity_id?: string
          id?: string
          metadata?: Json
          relationship_type?: string
          started_at?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_entity_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_entity_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_entity_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_entity_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_entity_relationships_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "corporate_entity_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_entity_relationships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          coaching_enabled: boolean
          created_at: string
          credit_data_provider: string | null
          credit_services_enabled: boolean
          legal_services_enabled: boolean
          readiness_scan_cadence: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          coaching_enabled?: boolean
          created_at?: string
          credit_data_provider?: string | null
          credit_services_enabled?: boolean
          legal_services_enabled?: boolean
          readiness_scan_cadence?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          coaching_enabled?: boolean
          created_at?: string
          credit_data_provider?: string | null
          credit_services_enabled?: boolean
          legal_services_enabled?: boolean
          readiness_scan_cadence?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invite_tokens: {
        Row: {
          actor_tier: string | null
          agency_role: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          default_role: Database["public"]["Enums"]["tenant_role"]
          email: string | null
          expires_at: string
          id: string
          kind: string
          last_used_at: string | null
          max_uses: number | null
          origin_account_id: string | null
          revoked_at: string | null
          target_tier: string | null
          tenant_id: string
          token: string
          updated_at: string
          uses: number
        }
        Insert: {
          actor_tier?: string | null
          agency_role?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["tenant_role"]
          email?: string | null
          expires_at?: string
          id?: string
          kind?: string
          last_used_at?: string | null
          max_uses?: number | null
          origin_account_id?: string | null
          revoked_at?: string | null
          target_tier?: string | null
          tenant_id: string
          token: string
          updated_at?: string
          uses?: number
        }
        Update: {
          actor_tier?: string | null
          agency_role?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["tenant_role"]
          email?: string | null
          expires_at?: string
          id?: string
          kind?: string
          last_used_at?: string | null
          max_uses?: number | null
          origin_account_id?: string | null
          revoked_at?: string | null
          target_tier?: string | null
          tenant_id?: string
          token?: string
          updated_at?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invite_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_invite_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_invite_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_invite_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_invite_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          doc_id: string
          embedding: string | null
          id: string
          tenant_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          doc_id: string
          embedding?: string | null
          id?: string
          tenant_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          doc_id?: string
          embedding?: string | null
          id?: string
          tenant_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_knowledge_chunks_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "tenant_knowledge_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_knowledge_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_knowledge_docs: {
        Row: {
          category: string | null
          chunk_count: number
          content: string
          created_at: string
          created_by: string
          id: string
          network_review_status: string
          network_reviewed_at: string | null
          network_reviewed_by: string | null
          promoted_to_canon_id: string | null
          share_to_network: boolean
          source: string
          source_url: string | null
          summary: string | null
          tags: string[] | null
          tenant_id: string
          title: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          chunk_count?: number
          content: string
          created_at?: string
          created_by: string
          id?: string
          network_review_status?: string
          network_reviewed_at?: string | null
          network_reviewed_by?: string | null
          promoted_to_canon_id?: string | null
          share_to_network?: boolean
          source?: string
          source_url?: string | null
          summary?: string | null
          tags?: string[] | null
          tenant_id: string
          title: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          chunk_count?: number
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          network_review_status?: string
          network_reviewed_at?: string | null
          network_reviewed_by?: string | null
          promoted_to_canon_id?: string | null
          share_to_network?: boolean
          source?: string
          source_url?: string | null
          summary?: string | null
          tags?: string[] | null
          tenant_id?: string
          title?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_knowledge_docs_promoted_to_canon_id_fkey"
            columns: ["promoted_to_canon_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_knowledge_docs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_legal_profile: {
        Row: {
          brand_display_name: string | null
          brand_logo_url: string | null
          created_at: string
          dba_name: string | null
          ein_last_4: string | null
          entity_type: string | null
          governing_law_state: string | null
          id: string
          legal_business_name: string
          logo_url: string | null
          registered_address: string | null
          service_agreement_body: string | null
          service_agreement_title: string | null
          service_agreement_updated_at: string | null
          signatory_name: string | null
          signatory_title: string | null
          state_of_formation: string | null
          support_email: string | null
          support_phone: string | null
          tenant_id: string
          updated_at: string
          white_label_ai_connect: boolean
        }
        Insert: {
          brand_display_name?: string | null
          brand_logo_url?: string | null
          created_at?: string
          dba_name?: string | null
          ein_last_4?: string | null
          entity_type?: string | null
          governing_law_state?: string | null
          id?: string
          legal_business_name: string
          logo_url?: string | null
          registered_address?: string | null
          service_agreement_body?: string | null
          service_agreement_title?: string | null
          service_agreement_updated_at?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          state_of_formation?: string | null
          support_email?: string | null
          support_phone?: string | null
          tenant_id: string
          updated_at?: string
          white_label_ai_connect?: boolean
        }
        Update: {
          brand_display_name?: string | null
          brand_logo_url?: string | null
          created_at?: string
          dba_name?: string | null
          ein_last_4?: string | null
          entity_type?: string | null
          governing_law_state?: string | null
          id?: string
          legal_business_name?: string
          logo_url?: string | null
          registered_address?: string | null
          service_agreement_body?: string | null
          service_agreement_title?: string | null
          service_agreement_updated_at?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          state_of_formation?: string | null
          support_email?: string | null
          support_phone?: string | null
          tenant_id?: string
          updated_at?: string
          white_label_ai_connect?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tenant_legal_profile_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_n8n_connections: {
        Row: {
          api_key_ct: string | null
          api_key_last4: string | null
          base_url_ct: string | null
          created_at: string
          created_by: string | null
          label: string | null
          last_error: string | null
          last_sync_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workflow_count: number
        }
        Insert: {
          api_key_ct?: string | null
          api_key_last4?: string | null
          base_url_ct?: string | null
          created_at?: string
          created_by?: string | null
          label?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workflow_count?: number
        }
        Update: {
          api_key_ct?: string | null
          api_key_last4?: string | null
          base_url_ct?: string | null
          created_at?: string
          created_by?: string | null
          label?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workflow_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_n8n_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_orders: {
        Row: {
          amount_total: number | null
          application_fee_amount: number | null
          created_at: string
          currency: string | null
          customer_email: string | null
          customer_name: string | null
          id: string
          metadata: Json
          price_id: string | null
          product_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_total?: number | null
          application_fee_amount?: number | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_total?: number | null
          application_fee_amount?: number | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_orders_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "tenant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "tenant_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_prices: {
        Row: {
          active: boolean
          billing_interval: string | null
          created_at: string
          currency: string
          id: string
          installments_total: number | null
          interval_count: number | null
          kind: string
          nickname: string | null
          product_id: string
          sort_order: number
          stripe_price_id: string | null
          tenant_id: string
          unit_amount: number
        }
        Insert: {
          active?: boolean
          billing_interval?: string | null
          created_at?: string
          currency?: string
          id?: string
          installments_total?: number | null
          interval_count?: number | null
          kind?: string
          nickname?: string | null
          product_id: string
          sort_order?: number
          stripe_price_id?: string | null
          tenant_id: string
          unit_amount: number
        }
        Update: {
          active?: boolean
          billing_interval?: string | null
          created_at?: string
          currency?: string
          id?: string
          installments_total?: number | null
          interval_count?: number | null
          kind?: string
          nickname?: string | null
          product_id?: string
          sort_order?: number
          stripe_price_id?: string | null
          tenant_id?: string
          unit_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "tenant_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_prices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_products: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          metadata: Json
          name: string
          product_type: string
          status: string
          stripe_product_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          name: string
          product_type?: string
          status?: string
          stripe_product_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          name?: string
          product_type?: string
          status?: string
          stripe_product_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_provisioning: {
        Row: {
          attempts: number
          created_at: string
          last_error: string | null
          parent_action_id: string | null
          status: string
          steps: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          last_error?: string | null
          parent_action_id?: string | null
          status?: string
          steps?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          last_error?: string | null
          parent_action_id?: string | null
          status?: string
          steps?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_provisioning_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_service_subscriptions: {
        Row: {
          application_fee_amount: number | null
          billing_period: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          end_customer_contact_id: string | null
          end_customer_user_id: string | null
          id: string
          metadata: Json
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id_ct: string | null
          stripe_subscription_id_ct: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          application_fee_amount?: number | null
          billing_period?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          end_customer_contact_id?: string | null
          end_customer_user_id?: string | null
          id?: string
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          application_fee_amount?: number | null
          billing_period?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          end_customer_contact_id?: string | null
          end_customer_user_id?: string | null
          id?: string
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id_ct?: string | null
          stripe_subscription_id_ct?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_service_subscriptions_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_end_customer_contact_id_fkey"
            columns: ["end_customer_contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "tenant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "tenant_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_service_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_service_usage_events: {
        Row: {
          amount_cents: number | null
          created_at: string
          end_customer_user_id: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          quantity: number
          subscription_id: string | null
          tenant_id: string
          unit_price_cents: number | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          end_customer_user_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number
          subscription_id?: string | null
          tenant_id: string
          unit_price_cents?: number | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          end_customer_user_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number
          subscription_id?: string | null
          tenant_id?: string
          unit_price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_service_usage_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "tenant_service_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_service_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_stripe_accounts: {
        Row: {
          account_type: string
          charges_enabled: boolean
          country: string | null
          created_at: string
          default_currency: string | null
          details_submitted: boolean
          payouts_enabled: boolean
          requirements: Json | null
          stripe_account_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_type?: string
          charges_enabled?: boolean
          country?: string | null
          created_at?: string
          default_currency?: string | null
          details_submitted?: boolean
          payouts_enabled?: boolean
          requirements?: Json | null
          stripe_account_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          charges_enabled?: boolean
          country?: string | null
          created_at?: string
          default_currency?: string | null
          details_submitted?: boolean
          payouts_enabled?: boolean
          requirements?: Json | null
          stripe_account_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_stripe_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_tool_autonomy: {
        Row: {
          created_at: string
          mode: string
          tenant_id: string
          tool_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          mode?: string
          tenant_id: string
          tool_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          mode?: string
          tenant_id?: string
          tool_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_tool_autonomy_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_workflows: {
        Row: {
          active: boolean
          created_by_paige: boolean
          first_seen_at: string
          folder: string | null
          last_run_at: string | null
          last_synced_at: string
          n8n_workflow_id: string
          name: string | null
          notes: string | null
          present_in_n8n: boolean
          source: string
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_by_paige?: boolean
          first_seen_at?: string
          folder?: string | null
          last_run_at?: string | null
          last_synced_at?: string
          n8n_workflow_id: string
          name?: string | null
          notes?: string | null
          present_in_n8n?: boolean
          source?: string
          tags?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_by_paige?: boolean
          first_seen_at?: string
          folder?: string | null
          last_run_at?: string | null
          last_synced_at?: string
          n8n_workflow_id?: string
          name?: string | null
          notes?: string | null
          present_in_n8n?: boolean
          source?: string
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_workflows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          account_number_prefix: string
          account_type: string
          automation_webhook_url_encrypted: string | null
          brand: Json
          created_at: string
          customer_limit: number
          features: Json
          id: string
          name: string
          onboarding_state: Json
          owner_user_id: string | null
          parent_tenant_id: string | null
          plan_offer: string | null
          platform_fee_bps: number
          seat_limit: number
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          account_number_prefix: string
          account_type?: string
          automation_webhook_url_encrypted?: string | null
          brand?: Json
          created_at?: string
          customer_limit?: number
          features?: Json
          id?: string
          name: string
          onboarding_state?: Json
          owner_user_id?: string | null
          parent_tenant_id?: string | null
          plan_offer?: string | null
          platform_fee_bps?: number
          seat_limit?: number
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          account_number_prefix?: string
          account_type?: string
          automation_webhook_url_encrypted?: string | null
          brand?: Json
          created_at?: string
          customer_limit?: number
          features?: Json
          id?: string
          name?: string
          onboarding_state?: Json
          owner_user_id?: string | null
          parent_tenant_id?: string | null
          plan_offer?: string | null
          platform_fee_bps?: number
          seat_limit?: number
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_parent_tenant_id_fkey"
            columns: ["parent_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_state: {
        Row: {
          client_id: string | null
          contact_email: string
          created_at: string
          current_period_end: string | null
          id: string
          last_payment_at: string | null
          organization_id: string | null
          payment_status: string
          source: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          tier: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          client_id?: string | null
          contact_email: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_payment_at?: string | null
          organization_id?: string | null
          payment_status?: string
          source?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          client_id?: string | null
          contact_email?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_payment_at?: string | null
          organization_id?: string | null
          payment_status?: string
          source?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tier_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tier_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tier_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      user_build_milestones: {
        Row: {
          business_id: string | null
          completed_at: string | null
          created_at: string
          evidence: Json | null
          id: string
          milestone_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          evidence?: Json | null
          id?: string
          milestone_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          evidence?: Json | null
          id?: string
          milestone_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_build_milestones_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_build_milestones_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "build_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      user_business_limits: {
        Row: {
          additional_business_monthly_fee: number
          additional_businesses_count: number
          created_at: string
          id: string
          max_businesses: number
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_business_monthly_fee?: number
          additional_businesses_count?: number
          created_at?: string
          id?: string
          max_businesses?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_business_monthly_fee?: number
          additional_businesses_count?: number
          created_at?: string
          id?: string
          max_businesses?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_funding_matches: {
        Row: {
          applied_at: string | null
          blocking_factors: Json | null
          calculated_at: string | null
          estimated_approval_amount: number | null
          id: string
          improvement_path: Json | null
          lender_product_id: string | null
          match_score: number | null
          match_status: string | null
          notified_at: string | null
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          blocking_factors?: Json | null
          calculated_at?: string | null
          estimated_approval_amount?: number | null
          id?: string
          improvement_path?: Json | null
          lender_product_id?: string | null
          match_score?: number | null
          match_status?: string | null
          notified_at?: string | null
          user_id: string
        }
        Update: {
          applied_at?: string | null
          blocking_factors?: Json | null
          calculated_at?: string | null
          estimated_approval_amount?: number | null
          id?: string
          improvement_path?: Json | null
          lender_product_id?: string | null
          match_score?: number | null
          match_status?: string | null
          notified_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_funding_matches_lender_product_id_fkey"
            columns: ["lender_product_id"]
            isOneToOne: false
            referencedRelation: "lender_products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_seen: string
          session_meta: Json
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          session_meta?: Json
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen?: string
          session_meta?: Json
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_progress: {
        Row: {
          completed_at: string | null
          course_id: string
          created_at: string | null
          id: string
          lesson_id: string | null
          notes: string | null
          progress_percentage: number | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          notes?: string | null
          progress_percentage?: number | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          notes?: string | null
          progress_percentage?: number | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_slug: string
          status: string
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_slug: string
          status?: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_slug?: string
          status?: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_usage: {
        Row: {
          ai_chats_used: number | null
          created_at: string | null
          disputes_used: number | null
          id: string
          reset_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_chats_used?: number | null
          created_at?: string | null
          disputes_used?: number | null
          id?: string
          reset_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_chats_used?: number | null
          created_at?: string | null
          disputes_used?: number | null
          id?: string
          reset_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vendor_offers: {
        Row: {
          affiliate_tag: string | null
          apply_url: string
          benefits: string | null
          category: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          requirements: string | null
          updated_at: string | null
        }
        Insert: {
          affiliate_tag?: string | null
          apply_url: string
          benefits?: string | null
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          requirements?: string | null
          updated_at?: string | null
        }
        Update: {
          affiliate_tag?: string | null
          apply_url?: string
          benefits?: string | null
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          requirements?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      voice_command_logs: {
        Row: {
          action: Json | null
          confirmation_required: boolean | null
          created_at: string | null
          id: string
          intent: string | null
          latency_ms: number | null
          scope: string | null
          slots: Json | null
          status: string
          turn_id: string
          user_id: string
          utterance: string
        }
        Insert: {
          action?: Json | null
          confirmation_required?: boolean | null
          created_at?: string | null
          id?: string
          intent?: string | null
          latency_ms?: number | null
          scope?: string | null
          slots?: Json | null
          status: string
          turn_id: string
          user_id: string
          utterance: string
        }
        Update: {
          action?: Json | null
          confirmation_required?: boolean | null
          created_at?: string | null
          id?: string
          intent?: string | null
          latency_ms?: number | null
          scope?: string | null
          slots?: Json | null
          status?: string
          turn_id?: string
          user_id?: string
          utterance?: string
        }
        Relationships: []
      }
      webhook_event_log: {
        Row: {
          created_at: string
          direction: string
          event_type: string
          http_status: number | null
          id: string
          payload_summary: Json | null
          request_payload: Json | null
          response_body: string | null
          retry_count: number
          status: string
          target_url: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          event_type: string
          http_status?: number | null
          id?: string
          payload_summary?: Json | null
          request_payload?: Json | null
          response_body?: string | null
          retry_count?: number
          status?: string
          target_url?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          event_type?: string
          http_status?: number | null
          id?: string
          payload_summary?: Json | null
          request_payload?: Json | null
          response_body?: string | null
          retry_count?: number
          status?: string
          target_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      _bank_rollup: {
        Row: {
          bank_connections: number | null
          bank_connections_active: number | null
          contact_id: string | null
          last_bank_sync_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_bank_connections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      _latest_cash_flow: {
        Row: {
          avg_daily_balance_cents: number | null
          contact_id: string | null
          funding_readiness_score: number | null
          generated_at: string | null
          period_end: string | null
          period_start: string | null
          runway_days: number | null
          total_deposits_cents: number | null
          total_withdrawals_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_cash_flow_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      _latest_owner_credit: {
        Row: {
          bureau: Database["public"]["Enums"]["owner_credit_bureau"] | null
          contact_id: string | null
          pulled_at: string | null
          score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_owner_credit_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      _signature_rollup: {
        Row: {
          contact_id: string | null
          envelopes_completed: number | null
          envelopes_pending: number | null
          envelopes_total: number | null
          last_signed_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_signature_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_daily_summary: {
        Row: {
          active_users: number | null
          churned_mrr: number | null
          credit_uploads: number | null
          date: string | null
          funding_applications: number | null
          new_mrr: number | null
          new_signups: number | null
          paige_sessions: number | null
          voice_sessions: number | null
        }
        Relationships: []
      }
      analytics_feature_usage: {
        Row: {
          date: string | null
          feature_name: string | null
          unique_users: number | null
          usage_count: number | null
        }
        Relationships: []
      }
      coach_client_profiles_safe: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string | null
          suspended_at: string | null
          suspended_reason: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      contact_deal_rollup: {
        Row: {
          contact_id: string | null
          open_deals: number | null
          open_value_cents: number | null
          won_deals: number | null
          won_value_cents: number | null
        }
        Relationships: []
      }
      contact_readiness_rollup: {
        Row: {
          assigned_coach_user_id: string | null
          avg_daily_balance_cents: number | null
          bank_connections: number | null
          bank_connections_active: number | null
          business_pulled_at: string | null
          business_scores: Json | null
          cash_flow_period_end: string | null
          cash_flow_readiness: number | null
          contact_id: string | null
          email: string | null
          entity_name: string | null
          envelopes_completed: number | null
          envelopes_pending: number | null
          envelopes_total: number | null
          first_name: string | null
          funding_goal: number | null
          last_bank_sync_at: string | null
          last_contacted_at: string | null
          last_name: string | null
          last_signed_at: string | null
          lifecycle_stage: string | null
          linked_user_id: string | null
          owner_bureau:
            | Database["public"]["Enums"]["owner_credit_bureau"]
            | null
          owner_fico: number | null
          owner_pulled_at: string | null
          readiness_score: number | null
          runway_days: number | null
          stored_overall_score: number | null
          stored_score_at: string | null
          tags: string[] | null
        }
        Relationships: []
      }
      paige_approval_queue_v: {
        Row: {
          age_seconds: number | null
          assigned_to_user_id: string | null
          category: string | null
          contact_email: string | null
          contact_first_name: string | null
          contact_id: string | null
          contact_last_name: string | null
          contact_lifecycle_stage: string | null
          conversation_id: string | null
          created_at: string | null
          draft_content: Json | null
          id: string | null
          metadata: Json | null
          priority: number | null
          requires_role: Database["public"]["Enums"]["app_role"] | null
          reviewed_at: string | null
          risk_level: string | null
          sent_at: string | null
          sla_due_at: string | null
          sla_state: string | null
          source: string | null
          status: string | null
          submitted_by_user_id: string | null
          summary: string | null
          tenant_id: string | null
          type: string | null
          visible_to_roles: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_deal_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_readiness_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "paige_unassigned_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "paige_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paige_pending_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      paige_unassigned_queue: {
        Row: {
          created_at: string | null
          email: string | null
          first_name: string | null
          ghl_contact_id: string | null
          id: string | null
          last_mirrored_at: string | null
          last_name: string | null
          priority_rank: number | null
          tier: string | null
          unassigned_for_hours: number | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          ghl_contact_id?: string | null
          id?: string | null
          last_mirrored_at?: string | null
          last_name?: string | null
          priority_rank?: never
          tier?: string | null
          unassigned_for_hours?: never
        }
        Update: {
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          ghl_contact_id?: string | null
          id?: string | null
          last_mirrored_at?: string | null
          last_name?: string | null
          priority_rank?: never
          tier?: string | null
          unassigned_for_hours?: never
        }
        Relationships: []
      }
      tier_send_ledger: {
        Row: {
          actor_tier: string | null
          created_at: string | null
          created_by: string | null
          kind_or_role: string | null
          origin_account_id: string | null
          origin_tier: string | null
          recipient_email: string | null
          send_id: string | null
          source_table: string | null
          status: string | null
          target_tier: string | null
        }
        Relationships: []
      }
      v_affiliate_stats: {
        Row: {
          active: boolean | null
          affiliate_id: string | null
          clicks: number | null
          commission_owed_cents: number | null
          commission_paid_ytd_cents: number | null
          commission_rate: number | null
          email: string | null
          full_name: string | null
          paid_conversions: number | null
          referral_code: string | null
          signups: number | null
          tier_key: string | null
          tier_name: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_referral_funnel_daily: {
        Row: {
          clicks: number | null
          day: string | null
          paid: number | null
          signups: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _assert_billing_admin: { Args: never; Returns: undefined }
      _automation_webhook_key: { Args: never; Returns: string }
      _log_billing_admin_action: {
        Args: {
          _action: string
          _contact_id: string
          _details: Json
          _subscription_id: string
        }
        Returns: undefined
      }
      _marketplace_active_bundle_holds: {
        Args: { _child_install: string }
        Returns: number
      }
      _marketplace_default_bundle_finance_violation: {
        Args: never
        Returns: string
      }
      _marketplace_finance_re: { Args: never; Returns: string }
      _marketplace_install_node: {
        Args: {
          _installed_by_agent: string
          _is_owner: boolean
          _item_slug: string
          _parent_install_id: string
          _path: string[]
          _seeded_kb_doc_ids: string[]
          _tenant_id: string
        }
        Returns: Json
      }
      _marketplace_is_service_role: { Args: never; Returns: boolean }
      _marketplace_operator_authorized: { Args: never; Returns: boolean }
      _marketplace_skill_referenced_elsewhere: {
        Args: { _exclude_install: string; _slug: string; _tenant_id: string }
        Returns: boolean
      }
      _marketplace_teardown_install: {
        Args: { _install_id: string; _tenant_id: string }
        Returns: Json
      }
      _ship26_assert_super_admin: { Args: never; Returns: undefined }
      accept_invitation: {
        Args: { _token: string; _user_id: string }
        Returns: Json
      }
      accept_platform_invite: { Args: { _token: string }; Returns: Json }
      accept_tenant_invite: { Args: { _token: string }; Returns: string }
      account_tier: { Args: { _tenant_id: string }; Returns: string }
      actor_manages_any_agency: { Args: { _actor: string }; Returns: boolean }
      actor_primary_agency: { Args: { _actor: string }; Returns: string }
      add_pipeline_stage: {
        Args: {
          _color?: string
          _label: string
          _order_index?: number
          _pipeline_id: string
          _probability?: number
          _stage_type?: string
        }
        Returns: string
      }
      admin_bulk_assign_coach: {
        Args: { _client_ids: string[]; _coach: string }
        Returns: Json
      }
      admin_cancel_customer_subscription: {
        Args: { _grace_period_days?: number; _subscription_id: string }
        Returns: undefined
      }
      admin_change_customer_subscription_price: {
        Args: { _new_price_id: string; _subscription_id: string }
        Returns: undefined
      }
      admin_create_customer_subscription: {
        Args: {
          _billing_period?: string
          _contact_id: string
          _price_id: string
          _start_date?: string
        }
        Returns: string
      }
      admin_force_signout_user: {
        Args: { target_user: string }
        Returns: number
      }
      admin_get_automation_webhook_url: {
        Args: { _tenant_id: string }
        Returns: string
      }
      admin_get_workflow_webhook_url:
        | { Args: { _workflow_id: string }; Returns: string }
        | { Args: { _workflow_slug: string }; Returns: string }
      admin_meta_capi_token_is_set: { Args: never; Returns: boolean }
      admin_metering_dead_letter_summary: {
        Args: never
        Returns: {
          dollars_at_risk: number
          event_type: string
          most_recent_failure: string
          oldest_failure: string
          row_count: number
          status: string
        }[]
      }
      admin_pause_customer_subscription: {
        Args: { _subscription_id: string }
        Returns: undefined
      }
      admin_propose_paige_actions: {
        Args: { p_actions: Json; p_contact_id: string }
        Returns: Json
      }
      admin_remove_coach_role: { Args: { _user_id: string }; Returns: Json }
      admin_resume_customer_subscription: {
        Args: { _subscription_id: string }
        Returns: undefined
      }
      admin_set_automation_webhook_url: {
        Args: { _tenant_id: string; _url: string }
        Returns: undefined
      }
      admin_set_booking_status: {
        Args: { _booking_id: string; _status: string }
        Returns: string
      }
      admin_set_meta_capi_token: {
        Args: { _token: string }
        Returns: undefined
      }
      admin_set_user_business_limit: {
        Args: { _max_businesses: number; _target_user_id: string }
        Returns: Json
      }
      advance_action: {
        Args: {
          p_action_id: string
          p_assigned_subagent_slug?: string
          p_assigned_to_user_id?: string
          p_decision_rationale?: string
          p_draft_content?: Json
          p_error?: string
          p_invocation_id?: string
          p_result?: Json
          p_tenant_id?: string
          p_to_status?: string
        }
        Returns: Json
      }
      agency_can_manage_child:
        | { Args: { _child: string }; Returns: boolean }
        | { Args: { _actor: string; _child: string }; Returns: boolean }
      agency_child_provisioned: { Args: { _child: string }; Returns: Json }
      agency_current_id: { Args: { _actor: string }; Returns: string }
      agency_enter_subaccount:
        | { Args: { _child: string }; Returns: Json }
        | { Args: { _actor: string; _child: string }; Returns: undefined }
      agency_exit_subaccount:
        | { Args: never; Returns: Json }
        | { Args: { _actor: string }; Returns: string }
      agency_list_my_subaccounts: {
        Args: never
        Returns: {
          account_type: string
          created_at: string
          id: string
          name: string
          slug: string
          status: string
        }[]
      }
      agency_list_team: {
        Args: never
        Returns: {
          agency_role: string
          email: string
          full_name: string
          is_you: boolean
          joined_at: string
          scoped_count: number
          scoped_subaccounts: string[]
          status: string
          user_id: string
        }[]
      }
      agency_lookup_user_id: { Args: { _email: string }; Returns: string }
      agency_my_membership: { Args: never; Returns: Json }
      agency_portfolio_metrics: { Args: never; Returns: Json }
      agency_provision_catalog_item: {
        Args: { _child: string; _enabled: boolean; _slug: string }
        Returns: Json
      }
      agency_remove_member: {
        Args: { _target_user: string }
        Returns: undefined
      }
      agency_set_member_role: {
        Args: { _role: string; _scoped?: string[]; _target_user: string }
        Returns: undefined
      }
      agency_set_member_status: {
        Args: { _status: string; _target_user: string }
        Returns: undefined
      }
      agency_subaccount_metrics: { Args: { _child: string }; Returns: Json }
      agency_switch_context: { Args: never; Returns: Json }
      agency_team_can_manage: {
        Args: { _actor: string; _agency: string }
        Returns: boolean
      }
      agency_team_role: {
        Args: { _actor: string; _agency: string }
        Returns: string
      }
      allocate_account_number: { Args: { _tenant_id: string }; Returns: string }
      approve_affiliate_application: {
        Args: { _application_id: string; _notes?: string; _tier_key?: string }
        Returns: Json
      }
      assign_contact: {
        Args: {
          p_contact_id: string
          p_role?: string
          p_tenant_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      assignment_role_for: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: string
      }
      attribute_conversion: {
        Args: {
          p_amount_cents: number
          p_event_type: string
          p_stripe_customer_id: string
          p_stripe_sub_id: string
          p_user_id: string
        }
        Returns: string
      }
      bump_subagent_quota: {
        Args: { _field: string; _tenant_id: string }
        Returns: {
          created_at: string
          hard_shipped: number
          id: string
          proposals_count: number
          quota_date: string
          soft_shipped: number
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "paige_subagent_factory_quota"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_host_load: {
        Args: { _cal: string }
        Returns: {
          full_name: string
          priority: number
          upcoming_count: number
          user_id: string
        }[]
      }
      _mp_caller_role_keys: {
        Args: { _actor?: string; _tenant_id?: string }
        Returns: string[]
      }
      _mp_tier_cascade_keys: {
        Args: { _tier: string }
        Returns: string[]
      }
      can_access_contact: {
        Args: { _contact_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_presence_topic: { Args: { _topic: string }; Returns: boolean }
      can_access_rail_topic: { Args: { _topic: string }; Returns: boolean }
      can_manage_calendar: { Args: { _cal: string }; Returns: boolean }
      can_manage_tenant_brand: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      cancel_internal_booking: {
        Args: { _booking_id: string; _reason?: string; _tenant_id?: string }
        Returns: Json
      }
      change_user_role: {
        Args: {
          _from_role: Database["public"]["Enums"]["app_role"]
          _reason?: string
          _target_user_id: string
          _tenant_id?: string
          _to_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      check_feature_access: {
        Args: { _feature: string; _user_id: string }
        Returns: boolean
      }
      check_public_rate_limit: {
        Args: { _bucket: string; _max?: number; _window_seconds?: number }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          _function_name: string
          _max_requests?: number
          _user_id: string
          _window_minutes?: number
        }
        Returns: boolean
      }
      claim_client: {
        Args: { _client_id: string }
        Returns: {
          active: boolean
          assigned_at: string
          assigned_role: string | null
          coach_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          notes: string | null
          rep_user_id: string | null
          role: string | null
          tenant_id: string | null
          unassigned_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "paige_coach_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_tenant_n8n_connection: {
        Args: { _tenant_id?: string }
        Returns: undefined
      }
      client_advance_onboarding_stage: {
        Args: { p_payload?: Json; p_to_stage: string }
        Returns: {
          client_id: string
          onboarding_stage: string
          updated_at: string
        }[]
      }
      client_custom_fields_upsert: {
        Args: { p_client_id: string; p_tenant_id: string; p_values: Json }
        Returns: {
          client_id: string
          created_at: string
          field_definition_id: string
          id: string
          tenant_id: string
          updated_at: string
          value: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "client_custom_field_values"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      client_has_role_assigned: {
        Args: { _assignment_role: string; _client: string }
        Returns: boolean
      }
      client_onboarding_status: {
        Args: { p_contact_id: string }
        Returns: {
          agreement_signed_at: string
          contact_id: string
          intake_submitted_at: string
          invite_accepted_at: string
          linked_user_id: string
          password_set_at: string
          ready: boolean
          stage: string
        }[]
      }
      client_view_ready: { Args: { p_contact_id: string }; Returns: boolean }
      coach_can_access_user: {
        Args: { _coach: string; _user: string }
        Returns: boolean
      }
      compute_contact_readiness: {
        Args: { _contact_id: string }
        Returns: number
      }
      create_calendar: {
        Args: {
          p_duration_min?: number
          p_enabled?: boolean
          p_owner_user_id?: string
          p_tenant_id: string
          p_title?: string
          p_type?: string
        }
        Returns: string
      }
      create_class_booking: {
        Args: {
          _calendar_id: string
          _capacity: number
          _contact_id?: string
          _end_at: string
          _guest_email: string
          _guest_name: string
          _guest_phone: string
          _host_user_id: string
          _intake_answers: Json
          _location_type: string
          _location_value: string
          _notes: string
          _source: string
          _start_at: string
          _tenant_id: string
          _timezone: string
          _title: string
        }
        Returns: {
          appointment_type: Json | null
          booking_kind: string
          calendar_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          capacity: number | null
          class_session_id: string | null
          collective_group_id: string | null
          contact_id: string | null
          created_at: string
          end_at: string
          external_calendar_id: string | null
          external_event_id: string | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          host_user_id: string
          id: string
          intake_answers: Json | null
          location: string | null
          location_type: string | null
          location_value: string | null
          manage_token_version: number
          meeting_link: string | null
          meeting_url: string | null
          notes: string | null
          reminder_state: Json
          source: string
          start_at: string
          status: string
          tenant_id: string | null
          timezone: string
          title: string
          updated_at: string
          zoom_meeting_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "internal_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_contact: {
        Args: {
          p_assigned_coach_user_id?: string
          p_created_by?: string
          p_email?: string
          p_entity_name?: string
          p_first_name: string
          p_last_name?: string
          p_lifecycle_stage?: string
          p_notes?: string
          p_phone?: string
          p_primary_offer?: string
          p_source?: string
          p_tags?: string[]
          p_tenant_id?: string
          p_title?: string
        }
        Returns: string
      }
      create_internal_booking: {
        Args: {
          _appointment_type?: Json
          _calendar_id?: string
          _contact_id?: string
          _end_at: string
          _guest_email?: string
          _guest_name?: string
          _guest_phone?: string
          _host_user_id?: string
          _intake_answers?: Json
          _location?: string
          _notes?: string
          _source?: string
          _start_at: string
          _status?: string
          _tenant_id?: string
          _timezone?: string
          _title: string
        }
        Returns: string
      }
      create_pipeline_with_stages: {
        Args: {
          _color?: string
          _created_by?: string
          _description?: string
          _is_default?: boolean
          _name: string
          _stages?: Json
          _tenant_id: string
        }
        Returns: string
      }
      create_platform_invite: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          accepted_at: string | null
          accepted_user_id: string | null
          actor_tier: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          origin_account_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          target_tier: string | null
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_subaccount:
        | {
            Args: {
              _description?: string
              _industry?: string
              _inherit_from_parent?: boolean
              _name: string
              _parent_tenant_id?: string
              _playbook_slug?: string
            }
            Returns: {
              account_number_prefix: string
              account_type: string
              automation_webhook_url_encrypted: string | null
              brand: Json
              created_at: string
              customer_limit: number
              features: Json
              id: string
              name: string
              onboarding_state: Json
              owner_user_id: string | null
              parent_tenant_id: string | null
              plan_offer: string | null
              platform_fee_bps: number
              seat_limit: number
              slug: string
              status: Database["public"]["Enums"]["tenant_status"]
              storefront_enabled: boolean
              stripe_customer_id: string | null
              stripe_subscription_id: string | null
              trial_ends_at: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "tenants"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _actor: string
              _description: string
              _industry: string
              _inherit_from_parent?: boolean
              _name: string
              _parent_tenant_id: string
              _playbook_slug?: string
            }
            Returns: {
              account_number_prefix: string
              account_type: string
              automation_webhook_url_encrypted: string | null
              brand: Json
              created_at: string
              customer_limit: number
              features: Json
              id: string
              name: string
              onboarding_state: Json
              owner_user_id: string | null
              parent_tenant_id: string | null
              plan_offer: string | null
              platform_fee_bps: number
              seat_limit: number
              slug: string
              status: Database["public"]["Enums"]["tenant_status"]
              storefront_enabled: boolean
              stripe_customer_id: string | null
              stripe_subscription_id: string | null
              trial_ends_at: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "tenants"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_tenant_invite_token: {
        Args: {
          _contact_id?: string
          _default_role?: Database["public"]["Enums"]["tenant_role"]
          _email?: string
          _expires_in_days?: number
          _kind?: string
          _max_uses?: number
          _tenant_id: string
        }
        Returns: {
          actor_tier: string | null
          agency_role: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          default_role: Database["public"]["Enums"]["tenant_role"]
          email: string | null
          expires_at: string
          id: string
          kind: string
          last_used_at: string | null
          max_uses: number | null
          origin_account_id: string | null
          revoked_at: string | null
          target_tier: string | null
          tenant_id: string
          token: string
          updated_at: string
          uses: number
        }
        SetofOptions: {
          from: "*"
          to: "tenant_invite_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cron_token_header: { Args: never; Returns: string }
      current_tenant_tier: { Args: { _tenant_id?: string }; Returns: string }
      current_user_roles: { Args: never; Returns: string[] }
      current_user_tenant_id: { Args: never; Returns: string }
      custom_field_definition_archive: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          field_type: string
          help_text: string | null
          id: string
          key: string
          label: string
          object_type: string
          options: Json | null
          position: number
          required: boolean
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "custom_field_definitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      custom_field_definition_upsert: {
        Args: {
          p_field_type: string
          p_help_text?: string
          p_id?: string
          p_key: string
          p_label: string
          p_options?: Json
          p_position?: number
          p_required?: boolean
          p_tenant_id: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          field_type: string
          help_text: string | null
          id: string
          key: string
          label: string
          object_type: string
          options: Json | null
          position: number
          required: boolean
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "custom_field_definitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_paige_activity_summary: {
        Args: { p_days?: number }
        Returns: Json
      }
      customer_respond_to_action: {
        Args: {
          p_action_id: string
          p_response_text?: string
          p_response_type: string
        }
        Returns: Json
      }
      default_max_businesses_for_plan: {
        Args: { _plan_slug: string }
        Returns: number
      }
      delete_credit_report_upload: {
        Args: { _calling_user_id: string; _upload_id: string }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_marketing_content: { Args: { p_id: string }; Returns: boolean }
      delete_pipeline: { Args: { _pipeline_id: string }; Returns: undefined }
      disable_tenant_event_kind: { Args: { p_slug: string }; Returns: Json }
      email_queue_dispatch: { Args: never; Returns: undefined }
      end_client_impersonation: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      enforce_doctrine_120: { Args: never; Returns: Json }
      enforce_doctrine_120_columns: { Args: never; Returns: Json }
      enforce_doctrine_120_full: { Args: never; Returns: Json }
      enforce_subagent_doctrine_116: {
        Args: never
        Returns: {
          out_action: string
          out_match: string
          out_slug: string
        }[]
      }
      enforce_subagent_doctrine_124: {
        Args: never
        Returns: {
          out_action: string
          out_pattern: string
          out_slug: string
        }[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enroll_contact_in_program: {
        Args: {
          p_contact_id: string
          p_program_id: string
          p_tenant_id?: string
        }
        Returns: Json
      }
      ensure_client_role_self_heal: {
        Args: never
        Returns: {
          client_id: string
          healed: boolean
          onboarding_stage: string
        }[]
      }
      ensure_owner_admin: { Args: never; Returns: undefined }
      expire_stale_readiness_proposals: { Args: never; Returns: number }
      factory_reset_delete_dispute_related: {
        Args: { _user_id: string }
        Returns: undefined
      }
      file_action: {
        Args: {
          p_action_kind: string
          p_autonomy_lane?: string
          p_contact_id?: string
          p_conversation_id?: string
          p_created_by_agent?: string
          p_due_at?: string
          p_from_department?: string
          p_parent_action_id?: string
          p_payload?: Json
          p_priority?: string
          p_summary?: string
          p_tenant_id?: string
          p_title: string
          p_to_department?: string
        }
        Returns: Json
      }
      fire_team_event: { Args: { payload: Json }; Returns: undefined }
      get_actor_access: { Args: { _actor: string }; Returns: Json }
      get_analytics_daily_summary: {
        Args: { _end?: string; _start?: string }
        Returns: {
          active_users: number | null
          churned_mrr: number | null
          credit_uploads: number | null
          date: string | null
          funding_applications: number | null
          new_mrr: number | null
          new_signups: number | null
          paige_sessions: number | null
          voice_sessions: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analytics_daily_summary"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_analytics_feature_usage: {
        Args: { _end?: string; _start?: string }
        Returns: {
          date: string | null
          feature_name: string | null
          unique_users: number | null
          usage_count: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analytics_feature_usage"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_approval_queue_counts: { Args: never; Returns: Json }
      get_broker_team_member: {
        Args: { _auth_user_id: string }
        Returns: {
          broker_id: string
          business_name: string
          email: string
          firm_description: string
          first_name: string
          id: string
          last_name: string
          permissions: Json
          role: string
          status: string
        }[]
      }
      get_business_hierarchy: {
        Args: { _user_id: string }
        Returns: {
          business_type: Database["public"]["Enums"]["business_hierarchy_type"]
          child_count: number
          display_order: number
          ein: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          legal_name: string
          organizational_level: number
          parent_business_id: string
        }[]
      }
      get_client_portal_brand: {
        Args: never
        Returns: {
          accent_color: string
          favicon_url: string
          font: string
          from_name: string
          logo_dark_url: string
          logo_url: string
          primary_color: string
          product_name: string
          support_email: string
          tagline: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      get_client_portal_config: { Args: never; Returns: Json }
      get_client_rail: {
        Args: { p_contact_id: string; p_lens?: string; p_limit?: number }
        Returns: {
          actor_type: string
          actor_user_id: string
          audience: string
          event_kind: string
          from_department: string
          id: string
          occurred_at: string
          payload: Json
          ref_id: string
          ref_table: string
          summary: string
          surface: string
          title: string
          to_department: string
          visibility: string
        }[]
      }
      get_client_service_agreement: {
        Args: never
        Returns: {
          agreement_body: string
          agreement_title: string
          tenant_name: string
        }[]
      }
      get_my_access: { Args: never; Returns: Json }
      get_my_ssn_last_4: { Args: never; Returns: string }
      get_outstanding_consents: {
        Args: { _user_id: string }
        Returns: {
          effective_date: string
          slug: string
          summary: string
          title: string
          version: number
        }[]
      }
      get_owner_onboarding_state: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      get_paige_context_fields: {
        Args: { _surface?: string }
        Returns: {
          column_name: string | null
          context_field_whitelist: string[]
          context_fk_column: string | null
          context_max_rows: number
          context_priority: number
          context_scope: string
          created_at: string
          ecosystem_owner: string
          external_source_label: string | null
          field_key: string
          id: string
          notes: string | null
          paige_context_eligible: boolean
          pii_sensitive: boolean
          realtime_enabled: boolean
          staleness_ttl_seconds: number | null
          surface: string
          sync_mechanism: string
          table_name: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "paige_data_source_registry"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_paige_persona_context: {
        Args: never
        Returns: {
          brand: Json
          funding_enabled: boolean
          playbook_config: Json
          playbook_slug: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      get_platform_email_settings: { Args: never; Returns: Json }
      get_platform_rail: {
        Args: { p_limit?: number; p_tenant_id?: string }
        Returns: {
          actor_type: string
          audience: string
          contact_id: string
          event_kind: string
          id: string
          occurred_at: string
          summary: string
          surface: string
          tenant_id: string
          title: string
          visibility: string
        }[]
      }
      get_profile_with_pii_log: {
        Args: { _user_id: string }
        Returns: {
          active_tenant_id: string | null
          address: string | null
          agency_login_default: string
          avatar_url: string | null
          biggest_obstacle: string | null
          business_name: string | null
          city: string | null
          coach_accepting_clients: boolean
          coach_bio: string | null
          coach_capacity: number | null
          coach_specialties: string[]
          coach_timezone: string | null
          consent_data_usage: boolean
          consent_marketing: boolean
          consent_privacy_policy: boolean
          consent_timestamp: string | null
          created_at: string | null
          credit_goals: Json | null
          credit_report_consent: boolean
          credit_report_consent_timestamp: string | null
          cross_bureau_discrepancies: Json | null
          dashboard_mode: string
          date_of_birth: string | null
          dob_last4: string | null
          estimated_fico_eq: number | null
          estimated_fico_ex: number | null
          estimated_fico_tu: number | null
          ethnicity: string[] | null
          experience_level: string | null
          financing_preference: string | null
          first_name: string | null
          full_name: string | null
          funding_goals: Json | null
          gender_identity: string | null
          ghl_contact_id: string | null
          goal_amount: number | null
          goal_timeline: string | null
          has_broker_access: boolean
          has_discrepancies: boolean | null
          has_equipment_assets: boolean
          has_investment_accounts: boolean
          has_invoice_receivables: boolean
          has_real_estate_equity: boolean
          id: string
          intake_completed: boolean
          intake_completed_at: string | null
          intake_responses: Json | null
          investment_account_value_range: string | null
          is_complimentary: boolean
          is_permanent_resident: boolean | null
          is_service_disabled_veteran: boolean | null
          is_us_citizen: boolean | null
          is_veteran: boolean | null
          last_fundability_calculated: string | null
          last_fundability_snapshot: Json | null
          last_name: string | null
          last_report_analyzed_at: string | null
          last_report_source: string | null
          middle_initial: string | null
          monthly_revenue_range: string | null
          onboarding_completed: boolean | null
          onboarding_step: string | null
          phone: string | null
          pme_phase: string | null
          postal_code: string | null
          primary_bank_average_balance: number | null
          primary_bank_months: number | null
          primary_bank_name: string | null
          primary_goal: string | null
          primary_goal_category: string | null
          real_estate_equity_range: string | null
          referral_code: string | null
          score_model: string | null
          signup_completed_at: string | null
          signup_lane: string | null
          signup_started_at: string | null
          ssn_encrypted: string | null
          ssn_last_4: string | null
          staff_notes: string | null
          state: string | null
          stripe_customer_id: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspended_reason: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          total_liquid_assets_range: string | null
          updated_at: string | null
          user_id: string
          website_url: string | null
          work_email: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_booking_page: {
        Args: { _slug: string }
        Returns: {
          availability_json: Json
          buffer_after_min: number
          buffer_before_min: number
          default_meeting_duration_min: number
          display_name: string
          tenant_id: string
          timezone: string
          user_id: string
        }[]
      }
      get_subaccount_metrics: {
        Args: { _actor: string; _child: string }
        Returns: Json
      }
      get_tenant_email_identity: {
        Args: { p_tenant_id?: string }
        Returns: Json
      }
      get_tenant_n8n_connection: {
        Args: { _tenant_id?: string }
        Returns: Json
      }
      get_tenant_n8n_secret: { Args: { _tenant_id: string }; Returns: Json }
      get_tenant_sender: {
        Args: { _tenant_id: string }
        Returns: {
          from_email: string
          from_name: string
          source: string
        }[]
      }
      get_tenant_service_agreement: {
        Args: { _tenant_id: string }
        Returns: {
          agreement_body: string
          agreement_title: string
          updated_at: string
        }[]
      }
      get_user_business_limit: { Args: { _user_id: string }; Returns: number }
      get_user_primary_tenant: {
        Args: { _user_id: string }
        Returns: {
          member_role: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      get_workspace_brand: {
        Args: never
        Returns: {
          brand_display_name: string
          brand_logo_url: string
          legal_business_name: string
          tenant_id: string
          tenant_name: string
          white_label_ai_connect: boolean
        }[]
      }
      grant_tenant_member_role: {
        Args: {
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id?: string
          _user_id: string
        }
        Returns: undefined
      }
      growth_claim_submission: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      growth_complete_submission: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      growth_fail_submission: {
        Args: { p_error?: string; p_submission_id: string }
        Returns: Json
      }
      growth_fire_submission_processor: {
        Args: { p_submission_id: string; p_tenant_id: string }
        Returns: undefined
      }
      growth_form_upsert: {
        Args: {
          p_auto_create_contact?: boolean
          p_id?: string
          p_name: string
          p_pipeline_id?: string
          p_schema_json: Json
          p_slug: string
          p_stage_id?: string
          p_success_action_json?: Json
          p_tenant_id: string
        }
        Returns: {
          auto_create_contact: boolean
          auto_create_deal: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          notify_user_ids: string[]
          pipeline_id: string | null
          schema_json: Json
          slug: string
          stage_id: string | null
          status: string
          success_action_json: Json
          template_key: string | null
          tenant_id: string
          updated_at: string
          workflow_slug: string | null
        }
        SetofOptions: {
          from: "*"
          to: "growth_forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      growth_funnel_publish: {
        Args: { p_id: string; p_tenant_id: string }
        Returns: Json
      }
      growth_funnel_session_upsert: {
        Args: {
          p_completed?: boolean
          p_funnel_id: string
          p_referrer?: string
          p_session_token?: string
          p_step?: number
          p_tenant_id?: string
          p_user_agent?: string
          p_utm_json?: Json
        }
        Returns: {
          completed: boolean
          created_at: string
          current_step: number
          funnel_id: string
          id: string
          referrer: string | null
          session_token: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
          utm_json: Json
        }
        SetofOptions: {
          from: "*"
          to: "growth_funnel_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      growth_funnel_upsert: {
        Args: {
          p_entry_page_id?: string
          p_goal?: string
          p_id?: string
          p_name: string
          p_slug: string
          p_steps?: Json
          p_success_page_id?: string
          p_tenant_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          entry_page_id: string | null
          goal: string | null
          id: string
          name: string
          slug: string
          status: string
          success_page_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "growth_funnels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      growth_page_edit_blocks: {
        Args: { p_id: string; p_ops: Json; p_tenant_id: string }
        Returns: Json
      }
      growth_page_publish: {
        Args: { p_id: string; p_tenant_id: string }
        Returns: Json
      }
      growth_page_upsert: {
        Args: {
          p_blocks_json: Json
          p_form_schema_json?: Json
          p_id?: string
          p_seo_json?: Json
          p_slug: string
          p_tenant_id: string
          p_theme_json?: Json
          p_title: string
        }
        Returns: {
          blocks_json: Json
          created_at: string
          created_by: string | null
          draft_blocks_json: Json | null
          draft_seo_json: Json | null
          draft_theme_json: Json | null
          id: string
          og_image_url: string | null
          published_at: string | null
          seo_json: Json
          slug: string
          status: string
          template_key: string | null
          tenant_id: string
          theme_json: Json
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "growth_pages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      growth_sweep_stuck_submissions: { Args: never; Returns: number }
      growth_validate_blocks: { Args: { p_blocks: Json }; Returns: undefined }
      growth_validate_form_schema: {
        Args: { p_schema: Json }
        Returns: undefined
      }
      handle_data_subject_request: {
        Args: {
          _contact_id: string
          _corrections?: Json
          _reason?: string
          _request_type: string
          _tenant_id: string
        }
        Returns: Json
      }
      has_any_role: {
        Args: { _roles: string[]; _user_id: string }
        Returns: boolean
      }
      has_email_marketing_consent: {
        Args: { _email: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_sms_consent: {
        Args: { _marketing?: boolean; _phone: string }
        Returns: boolean
      }
      has_tenant_role: {
        Args: { _role: string; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      increment_readiness_scan_counters: {
        Args: {
          _contacts_scanned?: number
          _credit_provider_calls?: number
          _credit_provider_cost_usd?: number
          _proposals_generated?: number
          _proposals_insufficient_data?: number
          _run_id: string
        }
        Returns: undefined
      }
      install_marketplace_item:
        | {
            Args: {
              _installed_by_agent?: string
              _item_slug: string
              _seeded_kb_doc_ids?: string[]
              _tenant_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _actor_user_id: string
              _installed_by_agent: string
              _item_slug: string
              _seeded_kb_doc_ids: string[]
              _tenant_id: string
            }
            Returns: Json
          }
      is_admin: { Args: { p_user_id: string }; Returns: boolean }
      is_assigned_coach: { Args: { _client_id: string }; Returns: boolean }
      is_assigned_to_client: {
        Args: { _assignment_role?: string; _client: string; _user: string }
        Returns: boolean
      }
      is_broker_team_member_of: {
        Args: { _broker_id: string }
        Returns: boolean
      }
      is_calendar_host: { Args: { _cal: string }; Returns: boolean }
      is_platform_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _actor: string }; Returns: boolean }
      is_platform_owner:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      is_program_client_owner: {
        Args: { _client_id: string }
        Returns: boolean
      }
      is_signup_complete:
        | { Args: never; Returns: boolean }
        | { Args: { _uid: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      is_tenant_admin: { Args: { _tenant: string }; Returns: boolean }
      is_tenant_admin_as: {
        Args: { _actor: string; _tenant: string }
        Returns: boolean
      }
      is_tenant_ancestor: {
        Args: { _candidate_ancestor: string; _tenant_id: string }
        Returns: boolean
      }
      is_tenant_member: { Args: { _tenant: string }; Returns: boolean }
      is_tenant_owner: {
        Args: { _tenant_id?: string; _user_id: string }
        Returns: boolean
      }
      list_actions: {
        Args: {
          p_action_id?: string
          p_contact_id?: string
          p_limit?: number
          p_status?: string
          p_tenant_id?: string
          p_to_department?: string
        }
        Returns: {
          action_kind: string
          actor_tier: string | null
          approval_id: string | null
          assigned_at: string | null
          assigned_subagent_slug: string | null
          assigned_to_user_id: string | null
          autonomy_lane: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          customer_action_id: string | null
          decision_rationale: string | null
          draft_content: Json | null
          drafted_at: string | null
          due_at: string | null
          error: string | null
          executed_at: string | null
          expires_at: string | null
          filed_at: string
          from_department: string
          id: string
          invocation_id: string | null
          origin_account_id: string | null
          parent_action_id: string | null
          payload: Json
          priority: string
          resolved_at: string | null
          result: Json | null
          status: string
          summary: string | null
          target_tier: string | null
          tenant_id: string
          title: string
          to_department: string
          updated_at: string
          workflow_run_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "paige_actions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_calendar_host_candidates: {
        Args: { _cal: string }
        Returns: {
          full_name: string
          is_host: boolean
          priority: number
          user_id: string
        }[]
      }
      list_event_kinds: {
        Args: never
        Returns: {
          default_audience: string
          default_visibility: string
          department: string
          description: string
          enabled: boolean
          is_platform_default: boolean
          label: string
          slug: string
          tenant_id: string
        }[]
      }
      list_pending_customer_actions: {
        Args: { p_contact_id: string }
        Returns: Json
      }
      list_platform_staff: {
        Args: never
        Returns: {
          email: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      list_subaccounts: {
        Args: { _actor: string }
        Returns: {
          account_type: string
          created_at: string
          id: string
          name: string
          slug: string
          status: string
        }[]
      }
      list_team_bookings: {
        Args: {
          _from: string
          _host_ids?: string[]
          _tenant_id?: string
          _to: string
        }
        Returns: {
          appointment_type: Json
          booking_kind: string
          calendar_id: string
          capacity: number
          class_session_id: string
          collective_group_id: string
          contact_id: string
          end_at: string
          guest_email: string
          guest_name: string
          guest_phone: string
          host_full_name: string
          host_user_id: string
          id: string
          intake_answers: Json
          location_type: string
          location_value: string
          notes: string
          source: string
          start_at: string
          status: string
          tenant_id: string
          timezone: string
          title: string
        }[]
      }
      list_team_members: {
        Args: { p_tenant_id?: string }
        Returns: {
          name: string
          role: string
          status: string
          user_id: string
        }[]
      }
      list_tenant_programs: {
        Args: { p_tenant_id?: string }
        Returns: {
          description: string
          id: string
          is_priority: boolean
          kind: string
          name: string
          status: string
        }[]
      }
      list_tenant_sender_identities: { Args: never; Returns: Json }
      list_tenant_workflows: {
        Args: { _tenant_id?: string }
        Returns: {
          active: boolean
          created_by_paige: boolean
          first_seen_at: string
          folder: string | null
          last_run_at: string | null
          last_synced_at: string
          n8n_workflow_id: string
          name: string | null
          notes: string | null
          present_in_n8n: boolean
          source: string
          tags: string[]
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tenant_workflows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_platform_trust_compass: { Args: never; Returns: Json }
      set_platform_trust_compass: {
        Args: { _away?: string; _ceiling?: number; _domains?: Json }
        Returns: Json
      }
      social_account_status: {
        Args: never
        Returns: {
          account_kind: string
          authorization_expires_at: string | null
          avatar_url: string | null
          capabilities: string[]
          connected_at: string | null
          connection_id: string
          display_name: string | null
          handle: string | null
          id: string
          last_synced_at: string | null
          last_verified_at: string | null
          platform: string
          selected: boolean
          status: string
        }[]
      }
      social_apply_connection_readback: {
        Args: {
          _accounts: Json
          _actor_id: string
          _attempt_id: string
          _connection_id: string
          _observed_at?: string
          _tenant_id: string
          _token_hash: string
        }
        Returns: Json
      }
      social_claim_connection_callback: {
        Args: { _attempt_id: string; _claimed_at?: string; _token_hash: string }
        Returns: Json
      }
      social_connection_access: { Args: never; Returns: boolean }
      social_connection_status: {
        Args: never
        Returns: {
          account_count: number
          authorization_expires_at: string | null
          disconnected_at: string | null
          failure_code: string | null
          id: string
          label: string | null
          last_verified_at: string | null
          status: string
          requested_platform: string | null
        }[]
      }
      social_current_tenant_id: { Args: never; Returns: string }
      social_mark_connection_disconnected: {
        Args: {
          _actor_id: string
          _confirmation_id: string
          _connection_id: string
          _disconnected_at?: string
          _tenant_id: string
        }
        Returns: Json
      }
      social_release_connection_attempt: {
        Args: {
          _actor_id: string
          _attempt_id: string
          _failure_code: string
          _released_at?: string
          _tenant_id: string
        }
        Returns: undefined
      }
      social_set_selected_account: {
        Args: {
          _account_id: string
          _actor_id: string
          _confirmation_id: string
          _connection_id: string
          _selected_at?: string
          _tenant_id: string
        }
        Returns: Json
      }
      list_tool_autonomy: {
        Args: { _tenant_id?: string }
        Returns: {
          category: string
          is_default: boolean
          label: string
          mode: string
          tool_key: string
          updated_at: string
        }[]
      }
      load_contact_context: {
        Args: { p_contact_id: string; p_scopes?: string[] }
        Returns: Json
      }
      load_self_context: { Args: never; Returns: Json }
      lookup_client_by_account_number: {
        Args: { _account_number: string }
        Returns: {
          account_number: string
          created_at: string
          email: string
          entity_name: string
          first_name: string
          id: string
          last_name: string
          lifecycle_stage: string
          linked_user_id: string
          phone: string
          status: string
          tenant_id: string
        }[]
      }
      map_app_role_to_tenant_role: {
        Args: { _app_role: Database["public"]["Enums"]["app_role"] }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      map_tenant_role_to_app_role: {
        Args: { _tenant_role: Database["public"]["Enums"]["tenant_role"] }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      marketplace_catalog_for_tenant:
        | {
            Args: { _tenant_id: string }
            Returns: {
              category: string
              description: string
              icon: string
              install_status: string
              installed: boolean
              item_type: Database["public"]["Enums"]["marketplace_item_type"]
              name: string
              price_cents: number
              pricing_model: string
              requires_embedding: boolean
              slug: string
              tagline: string
              version: string
            }[]
          }
        | {
            Args: { _actor_user_id: string; _tenant_id: string }
            Returns: {
              category: string
              description: string
              icon: string
              install_status: string
              installed: boolean
              item_type: Database["public"]["Enums"]["marketplace_item_type"]
              name: string
              price_cents: number
              pricing_model: string
              requires_embedding: boolean
              slug: string
              tagline: string
              version: string
            }[]
          }
      marketplace_deprecate_version: {
        Args: { _item_slug: string; _semver: string }
        Returns: Json
      }
      marketplace_install_refcount:
        | { Args: { _item_slug: string; _tenant_id: string }; Returns: Json }
        | {
            Args: {
              _actor_user_id: string
              _item_slug: string
              _tenant_id: string
            }
            Returns: Json
          }
      marketplace_operator_catalog: {
        Args: never
        Returns: {
          billing_period: string
          category: string
          created_at: string
          current_payload_class: Database["public"]["Enums"]["marketplace_payload_class"]
          current_semver: string
          current_version_id: string
          current_version_is_published: boolean
          current_version_status: Database["public"]["Enums"]["marketplace_version_status"]
          default_for_new_tenants: boolean
          featured: boolean
          icon: string
          id: string
          install_count: number
          is_finance: boolean
          item_type: Database["public"]["Enums"]["marketplace_item_type"]
          name: string
          origin: Database["public"]["Enums"]["marketplace_origin"]
          paid_install_count: number
          platform_fee_cents: number
          price_cents: number
          pricing_model: string
          rating_avg: number
          rating_count: number
          refunds_cents: number
          revenue_event_count: number
          revenue_gross_cents: number
          scope: Database["public"]["Enums"]["marketplace_scope"]
          serves: string
          slug: string
          status: Database["public"]["Enums"]["marketplace_item_status"]
          tagline: string
          take_rate_bps: number
          updated_at: string
          vendor_net_cents: number
          vendor_slug: string
          version_count: number
        }[]
      }
      marketplace_publish_version: {
        Args: {
          _changelog?: string
          _install_manifest?: Json
          _item_slug: string
          _payload_class?: string
          _semver: string
        }
        Returns: Json
      }
      marketplace_set_current_version: {
        Args: { _item_slug: string; _semver: string }
        Returns: Json
      }
      marketplace_set_default_for_new_tenants: {
        Args: { _item_slug: string; _on: boolean }
        Returns: Json
      }
      marketplace_set_featured: {
        Args: { _item_slug: string; _on: boolean }
        Returns: Json
      }
      marketplace_set_item_status: {
        Args: { _item_slug: string; _status: string }
        Returns: Json
      }
      marketplace_upsert_item: {
        Args: {
          _billing_period?: string
          _category?: string
          _description?: string
          _icon?: string
          _is_finance?: boolean
          _item_type?: string
          _name?: string
          _price_cents?: number
          _pricing_model?: string
          _scope?: string
          _serves?: string
          _slug: string
          _tagline?: string
          _take_rate_bps?: number
          _visible_to_agency_id?: string
          _visible_to_tenant_id?: string
        }
        Returns: Json
      }
      match_paige_memory: {
        Args: {
          _match_threshold?: number
          _memory_count?: number
          _message_count?: number
          _query_embedding: string
          _target_client_id?: string
          _target_user_id: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          memory_type: string
          similarity: number
          source: string
        }[]
      }
      match_rag_documents: {
        Args: {
          _document_types?: string[]
          _match_count?: number
          _match_threshold?: number
          _metadata_filter?: Json
          _query_embedding: string
          _query_text?: string
        }
        Returns: {
          content: string
          document_type: string
          id: string
          metadata: Json
          quality_score: number
          similarity: number
          summary: string
          title: string
        }[]
      }
      match_tenant_knowledge: {
        Args: {
          p_match_count?: number
          p_query_embedding: string
          p_tenant_id: string
        }
        Returns: {
          chunk_id: string
          content: string
          doc_id: string
          similarity: number
          source_tier: string
          title: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      operator_at_risk_tenants: {
        Args: { p_days?: number }
        Returns: {
          last_active: string
          mrr_cents: number
          name: string
          reason: string
          tenant_id: string
          tier: string
        }[]
      }
      operator_dashboard_metrics: {
        Args: { p_window_days?: number }
        Returns: Json
      }
      operator_tier_send_feed: {
        Args: { _since?: string; _tier?: string }
        Returns: {
          actor_tier: string
          created_at: string
          created_by: string
          kind_or_role: string
          origin_account_id: string
          origin_tier: string
          recipient_email: string
          send_id: string
          source_table: string
          status: string
          target_tier: string
        }[]
      }
      paige_chat_thread_create: {
        Args: {
          p_consent_snapshot: Json
          p_contact_id: string
          p_lens: string
          p_title: string
        }
        Returns: string
      }
      paige_chat_turn_append: {
        Args: {
          p_bundle_ref: Json
          p_content: string
          p_latency_ms: number
          p_load_id: string
          p_model: string
          p_role: string
          p_surfaces_used: string[]
          p_thread_id: string
          p_tokens_used: number
          p_tool_calls?: Json
        }
        Returns: string
      }
      paige_resolve_autonomy: {
        Args: { p_default: string; p_kind: string; p_tenant: string }
        Returns: string
      }
      paige_tool_add_client_note: {
        Args: {
          p_category?: string
          p_contact_id: string
          p_content: string
          p_thread_id: string
        }
        Returns: Json
      }
      paige_tool_create_task: {
        Args: {
          p_contact_id: string
          p_description?: string
          p_due_date?: string
          p_priority?: string
          p_thread_id: string
          p_title: string
        }
        Returns: Json
      }
      peek_tenant_invite: {
        Args: { _token: string }
        Returns: {
          brand: Json
          default_role: Database["public"]["Enums"]["tenant_role"]
          expires_at: string
          invited_email: string
          is_valid: boolean
          kind: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      peek_tenant_portal_brand: {
        Args: { _slug: string }
        Returns: {
          accent_color: string
          favicon_url: string
          font: string
          logo_dark_url: string
          logo_url: string
          primary_color: string
          product_name: string
          tagline: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      plan_add_milestone: {
        Args: {
          p_assigned_to_user_id?: string
          p_due_at?: string
          p_plan_id: string
          p_priority?: string
          p_summary?: string
          p_tenant_id?: string
          p_title: string
        }
        Returns: Json
      }
      plan_assign_task: {
        Args: {
          p_assigned_to_user_id: string
          p_campaign_ref?: Json
          p_contact_id?: string
          p_due_at?: string
          p_file_to_bus?: boolean
          p_milestone_id?: string
          p_plan_id?: string
          p_priority?: string
          p_summary?: string
          p_tenant_id?: string
          p_title: string
        }
        Returns: Json
      }
      plan_create: {
        Args: {
          p_campaign_ref?: Json
          p_ends_on: string
          p_horizon: string
          p_owner_user_id?: string
          p_scope?: string
          p_starts_on: string
          p_summary?: string
          p_tenant_id?: string
          p_title: string
        }
        Returns: Json
      }
      plan_list: {
        Args: {
          p_assigned_to_user_id?: string
          p_by_item_date?: boolean
          p_contact_id?: string
          p_from?: string
          p_horizon?: string
          p_limit?: number
          p_plan_id?: string
          p_status?: string
          p_tenant_id?: string
          p_to?: string
        }
        Returns: Json
      }
      plan_remove_item: {
        Args: { p_item_id: string; p_tenant_id?: string }
        Returns: Json
      }
      plan_set_reminder: {
        Args: {
          p_channel?: string
          p_contact_id?: string
          p_plan_id?: string
          p_remind_at: string
          p_summary?: string
          p_target?: string
          p_target_user_id?: string
          p_tenant_id?: string
          p_title: string
        }
        Returns: Json
      }
      plan_update_item: {
        Args: {
          p_assigned_to_user_id?: string
          p_due_at?: string
          p_item_id: string
          p_priority?: string
          p_remind_at?: string
          p_status?: string
          p_summary?: string
          p_tenant_id?: string
          p_title?: string
        }
        Returns: Json
      }
      platform_decrypt: { Args: { ciphertext: string }; Returns: string }
      platform_encrypt: { Args: { plaintext: string }; Returns: string }
      platform_set_growth_external_source_token: {
        Args: { _id: string; _token: string }
        Returns: undefined
      }
      platform_set_mcp_server_url: {
        Args: { _id: string; _url: string }
        Returns: undefined
      }
      platform_set_n8n_base_url: {
        Args: { _id: string; _url: string }
        Returns: undefined
      }
      platform_set_outbound_webhook_url: {
        Args: { _id: string; _url: string }
        Returns: undefined
      }
      platform_set_plaid_access_token: {
        Args: { _row_id: string; _token: string }
        Returns: undefined
      }
      platform_set_workflow_webhook_url: {
        Args: { _url: string; _workflow_slug: string }
        Returns: undefined
      }
      pmedl_retry_scan: {
        Args: never
        Returns: {
          escalated: number
          picked: number
        }[]
      }
      practice_attention_queue: { Args: never; Returns: Json }
      practice_dashboard_metrics: {
        Args: { p_window_days?: number }
        Returns: Json
      }
      presence_check_user: {
        Args: { p_query: string; p_window_seconds?: number }
        Returns: {
          avatar_url: string
          full_name: string
          is_online: boolean
          last_seen: string
          status: string
          user_id: string
        }[]
      }
      presence_go_offline: { Args: never; Returns: undefined }
      presence_heartbeat: {
        Args: { p_meta?: Json; p_status?: string }
        Returns: undefined
      }
      presence_list_online: {
        Args: { p_tenant_id?: string; p_window_seconds?: number }
        Returns: {
          avatar_url: string
          full_name: string
          last_seen: string
          session_meta: Json
          status: string
          tenant_id: string
          user_id: string
        }[]
      }
      process_starter_provisioning_queue: { Args: never; Returns: number }
      provision_tenant: {
        Args: {
          _account_type?: string
          _agreement_slug?: string
          _agreement_version?: number
          _description?: string
          _industry?: string
          _name: string
          _team_size?: string
        }
        Returns: {
          account_number_prefix: string
          account_type: string
          automation_webhook_url_encrypted: string | null
          brand: Json
          created_at: string
          customer_limit: number
          features: Json
          id: string
          name: string
          onboarding_state: Json
          owner_user_id: string | null
          parent_tenant_id: string | null
          plan_offer: string | null
          platform_fee_bps: number
          seat_limit: number
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provision_tenant_default_calendar: {
        Args: { _tenant_id: string }
        Returns: string
      }
      provision_tenant_email_identity: {
        Args: { _tenant_id: string }
        Returns: {
          custom_domain_id: string | null
          from_name: string
          kind: string
          local_part: string
          provisioned_at: string
          reply_to: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_email_identities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      qb_decrypt_token: { Args: { _ciphertext: string }; Returns: string }
      qb_encrypt_token: { Args: { _plaintext: string }; Returns: string }
      rag_recalibrate_quality: {
        Args: never
        Returns: {
          boosted_high: number
          flagged_low: number
        }[]
      }
      reactivate_user: { Args: { _user_id: string }; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reassign_coach_clients: {
        Args: { _from_coach: string; _to_coach: string }
        Returns: number
      }
      record_communications_consent: {
        Args: {
          p_contact_id?: string
          p_email: string
          p_email_marketing?: boolean
          p_ip_address?: string
          p_phone?: string
          p_sms_marketing?: boolean
          p_sms_transactional?: boolean
          p_source?: string
          p_tenant_id?: string
          p_user_agent?: string
          p_voice_marketing?: boolean
        }
        Returns: string
      }
      record_paige_workflow: {
        Args: { _n8n_workflow_id: string; _name: string; _tenant_id: string }
        Returns: undefined
      }
      record_rail_event: {
        Args: {
          p_actor_type: string
          p_contact_id: string
          p_event_kind: string
          p_from_department?: string
          p_narrow_to_owner?: boolean
          p_occurred_at?: string
          p_payload?: Json
          p_ref_id?: string
          p_ref_table?: string
          p_summary?: string
          p_surface: string
          p_tenant_id?: string
          p_title: string
          p_to_department?: string
        }
        Returns: string
      }
      refresh_analytics_views: { Args: never; Returns: undefined }
      reject_affiliate_application: {
        Args: { _application_id: string; _notes?: string }
        Returns: Json
      }
      reorder_pipeline_stages: {
        Args: { _ordered_ids: string[]; _pipeline_id: string }
        Returns: undefined
      }
      require_tenant_brand: { Args: { p_tenant_id: string }; Returns: Json }
      reschedule_class_booking: {
        Args: { _new_end_at: string; _new_start_at: string; _seat_id: string }
        Returns: {
          appointment_type: Json | null
          booking_kind: string
          calendar_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          capacity: number | null
          class_session_id: string | null
          collective_group_id: string | null
          contact_id: string | null
          created_at: string
          end_at: string
          external_calendar_id: string | null
          external_event_id: string | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          host_user_id: string
          id: string
          intake_answers: Json | null
          location: string | null
          location_type: string | null
          location_value: string | null
          manage_token_version: number
          meeting_link: string | null
          meeting_url: string | null
          notes: string | null
          reminder_state: Json
          source: string
          start_at: string
          status: string
          tenant_id: string | null
          timezone: string
          title: string
          updated_at: string
          zoom_meeting_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "internal_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_internal_booking: {
        Args: {
          _booking_id: string
          _end_at: string
          _start_at: string
          _tenant_id?: string
        }
        Returns: Json
      }
      resolve_actor_tier: {
        Args: { _actor: string; _origin: string }
        Returns: string
      }
      resolve_client_id_by_email: { Args: { _email: string }; Returns: string }
      resolve_contact_id: {
        Args: {
          p_email?: string
          p_phone?: string
          p_tenant: string
          p_user_id?: string
        }
        Returns: string
      }
      resolve_starter_playbook_slug: {
        Args: { _industry: string }
        Returns: string
      }
      resolve_tenant_brand: {
        Args: { _tenant_id: string }
        Returns: {
          accent_color: string
          custom_domain: string
          favicon_url: string
          font: string
          from_name: string
          logo_dark_url: string
          logo_url: string
          primary_color: string
          product_name: string
          support_email: string
          tagline: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
        }[]
      }
      resolve_tenant_sender: { Args: { _tenant_id: string }; Returns: Json }
      resolve_tool_autonomy: {
        Args: { _tenant_id: string; _tool_key: string }
        Returns: string
      }
      revoke_platform_access:
        | { Args: { _user_id: string }; Returns: undefined }
        | { Args: { _reason?: string; _user_id: string }; Returns: undefined }
      revoke_platform_admin: { Args: { _user_id: string }; Returns: undefined }
      revoke_tenant_member_role: {
        Args: {
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id?: string
          _user_id: string
        }
        Returns: Json
      }
      run_starter_provisioning: {
        Args: { _force?: boolean; _steps?: string[]; _tenant_id: string }
        Returns: Json
      }
      sanitize_email_local_part: { Args: { _raw: string }; Returns: string }
      save_marketing_content: {
        Args: {
          p_body?: string
          p_brief?: string
          p_channel?: string
          p_id?: string
          p_image_path?: string
          p_image_url?: string
          p_kind: string
          p_meta?: Json
          p_size?: string
          p_tenant_id?: string
          p_title: string
        }
        Returns: string
      }
      scan_soft_subagents_for_tool_refs: {
        Args: never
        Returns: {
          out_pattern: string
          out_slug: string
        }[]
      }
      seed_starter_business: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      set_agency_login_default: { Args: { _pref: string }; Returns: Json }
      set_calendar_hosts: {
        Args: { _cal: string; _hosts: Json }
        Returns: undefined
      }
      set_journey_stage: {
        Args: {
          _contact_id: string
          _source_event?: string
          _stage_slug: string
        }
        Returns: Json
      }
      set_owner_onboarding_state: {
        Args: { p_patch: Json; p_tenant_id: string }
        Returns: Json
      }
      set_platform_email_settings: {
        Args: {
          p_default_from_name?: string
          p_default_reply_to?: string
          p_shared_domain?: string
        }
        Returns: Json
      }
      set_tenant_account_type: {
        Args: { _account_type: string; _tenant_id: string }
        Returns: {
          account_number_prefix: string
          account_type: string
          automation_webhook_url_encrypted: string | null
          brand: Json
          created_at: string
          customer_limit: number
          features: Json
          id: string
          name: string
          onboarding_state: Json
          owner_user_id: string | null
          parent_tenant_id: string | null
          plan_offer: string | null
          platform_fee_bps: number
          seat_limit: number
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_tenant_brand: {
        Args: { _patch: Json; _tenant_id: string }
        Returns: Json
      }
      set_tenant_email_identity: {
        Args: {
          p_from_name?: string
          p_local_part?: string
          p_reply_to?: string
          p_tenant_id?: string
        }
        Returns: Json
      }
      set_tenant_n8n_connection: {
        Args: {
          _api_key: string
          _base_url: string
          _label?: string
          _tenant_id?: string
        }
        Returns: Json
      }
      set_tenant_playbook: {
        Args: {
          _config?: Json
          _only_if_unset?: boolean
          _slug?: string
          _tenant_id: string
        }
        Returns: {
          account_number_prefix: string
          account_type: string
          automation_webhook_url_encrypted: string | null
          brand: Json
          created_at: string
          customer_limit: number
          features: Json
          id: string
          name: string
          onboarding_state: Json
          owner_user_id: string | null
          parent_tenant_id: string | null
          plan_offer: string | null
          platform_fee_bps: number
          seat_limit: number
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          storefront_enabled: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_tenant_portal_config: {
        Args: { _patch: Json; _tenant_id: string }
        Returns: Json
      }
      set_tenant_service_agreement: {
        Args: { _body: string; _tenant_id: string; _title: string }
        Returns: undefined
      }
      set_tenant_skill: {
        Args: { _enabled: boolean; _skill: string; _tenant_id: string }
        Returns: Json
      }
      set_tenant_workflow_folder: {
        Args: { _folder: string; _n8n_workflow_id: string; _tenant_id?: string }
        Returns: undefined
      }
      set_tool_autonomy: {
        Args: { _mode: string; _tenant_id?: string; _tool_key: string }
        Returns: {
          created_at: string
          mode: string
          tenant_id: string
          tool_key: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_tool_autonomy"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ship_26_check_dependencies: { Args: never; Returns: Json }
      ship_26_drop_legacy_tables: { Args: { _force?: boolean }; Returns: Json }
      ship_26_freeze_legacy_tables: { Args: never; Returns: Json }
      start_client_impersonation: {
        Args: { p_contact_id: string }
        Returns: {
          client_name: string
          contact_id: string
          linked_user_id: string
        }[]
      }
      suspend_user: {
        Args: { _reason: string; _user_id: string }
        Returns: undefined
      }
      sync_tenant_workflows: {
        Args: { _tenant_id: string; _workflows: Json }
        Returns: number
      }
      tenant_feature_enabled: {
        Args: { _feature: string; _tenant_id: string }
        Returns: boolean
      }
      tenant_has_feature: { Args: { _feature: string }; Returns: boolean }
      tenant_sender_identity: { Args: { _tenant_id: string }; Returns: Json }
      tier_pool_for_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: string[]
      }
      trigger_business_credit_sync: {
        Args: { _user_id: string }
        Returns: Json
      }
      trigger_readiness_scan_cron: { Args: never; Returns: undefined }
      unassigned_queue_for_caller: {
        Args: never
        Returns: {
          created_at: string | null
          email: string | null
          first_name: string | null
          ghl_contact_id: string | null
          id: string | null
          last_mirrored_at: string | null
          last_name: string | null
          priority_rank: number | null
          tier: string | null
          unassigned_for_hours: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "paige_unassigned_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      uninstall_marketplace_item:
        | { Args: { _item_slug: string; _tenant_id: string }; Returns: Json }
        | {
            Args: {
              _actor_user_id: string
              _item_slug: string
              _tenant_id: string
            }
            Returns: Json
          }
      update_contact: {
        Args: {
          p_assigned_coach_user_id?: string
          p_contact_id: string
          p_email?: string
          p_entity_name?: string
          p_first_name?: string
          p_last_name?: string
          p_lifecycle_stage?: string
          p_notes?: string
          p_phone?: string
          p_primary_offer?: string
          p_status?: string
          p_title?: string
        }
        Returns: undefined
      }
      upsert_contact: {
        Args: {
          p_actor_user_id?: string
          p_channel?: string
          p_contact_id?: string
          p_patch: Json
          p_tenant_id?: string
        }
        Returns: string
      }
      update_profile_ssn: {
        Args: {
          _date_of_birth: string
          _ssn_encrypted: string
          _ssn_last_4: string
          _user_id: string
        }
        Returns: undefined
      }
      update_tenant_n8n_sync: {
        Args: {
          _last_error?: string
          _status: string
          _tenant_id: string
          _workflow_count?: number
        }
        Returns: undefined
      }
      upsert_tenant_event_kind: {
        Args: {
          p_default_audience: string
          p_default_visibility: string
          p_department: string
          p_description: string
          p_label: string
          p_slug: string
        }
        Returns: Json
      }
      verify_certificate_by_code: {
        Args: { _verification_code: string }
        Returns: {
          certificate_url: string
          course_id: string
          issued_at: string
          verification_code: string
        }[]
      }
      verify_cron_token: { Args: { _token: string }; Returns: boolean }
    }
    Enums: {
      access_tier:
        | "god"
        | "agency"
        | "tenant"
        | "subaccount"
        | "client"
        | "none"
      account_type:
        | "credit_card"
        | "auto_loan"
        | "mortgage"
        | "personal_loan"
        | "student_loan"
        | "collections"
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "affiliate"
        | "coach"
        | "broker"
        | "broker_team_member"
        | "super_admin"
        | "sales_rep"
        | "cs_rep"
        | "finance"
        | "viewer"
        | "client"
        | "developer"
        | "platform_admin"
      business_hierarchy_type:
        | "holding"
        | "parent"
        | "subsidiary"
        | "standalone"
      client_file_visibility: "internal" | "shared" | "client_upload"
      consent_type:
        | "credit_report_access"
        | "croa_rights"
        | "data_sharing"
        | "offer_display"
        | "adverse_action"
      credit_prediction_confidence: "high" | "medium" | "low"
      credit_prediction_type:
        | "score_drop_warning"
        | "score_increase_opportunity"
        | "reporting_date_optimization"
        | "account_age_risk"
        | "utilization_spike_warning"
        | "inquiry_strategy"
        | "new_account_timing"
        | "payment_history_risk"
        | "credit_mix_opportunity"
        | "funding_window_alert"
      denial_reason_category:
        | "credit_score_too_low"
        | "insufficient_time_in_business"
        | "insufficient_revenue"
        | "too_much_existing_debt"
        | "no_collateral"
        | "incomplete_application"
        | "industry_restriction"
        | "too_many_recent_inquiries"
        | "derogatory_items"
        | "insufficient_cash_flow"
        | "personal_guarantee_declined"
        | "entity_structure_issue"
        | "other"
      disclosure_type:
        | "credit_report_access"
        | "croa_rights_notice"
        | "data_sharing_consent"
        | "offer_display_disclaimer"
        | "adverse_action_routing"
        | "educational_purposes"
      dispute_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "resolved"
        | "rejected"
      entity_type: "LLC" | "Corporation" | "Sole Proprietorship" | "Partnership"
      funding_journey_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "denied"
        | "withdrawn"
        | "funded"
      funding_milestone_type:
        | "first_application"
        | "first_approval"
        | "first_funding"
        | "score_threshold_crossed"
        | "debt_cleared"
        | "business_credit_established"
        | "dscr_qualified"
        | "sba_eligible"
      knowledge_category:
        | "framework"
        | "principle"
        | "practice"
        | "model"
        | "stage"
        | "implementation"
      letter_status: "draft" | "generated" | "sent" | "delivered"
      marketplace_item_status: "listed" | "unlisted" | "archived"
      marketplace_item_type:
        | "skin"
        | "skill"
        | "kb_pack"
        | "tool"
        | "portal_surface"
        | "automation"
        | "bundle"
      marketplace_origin: "first_party" | "vendor"
      marketplace_payload_class: "config_only" | "code"
      marketplace_scope: "public" | "tenant" | "agency"
      marketplace_version_status:
        | "draft"
        | "submitted"
        | "in_review"
        | "changes_requested"
        | "approved"
        | "published"
        | "deprecated"
        | "rejected"
      naics_risk_category:
        | "low_risk"
        | "moderate_risk"
        | "high_risk"
        | "specialized"
      notification_type:
        | "dispute_update"
        | "payment_success"
        | "subscription_change"
        | "task_reminder"
        | "credit_report_ready"
        | "welcome"
        | "system"
      order_status: "pending" | "completed" | "failed" | "refunded"
      owner_credit_bureau: "experian" | "equifax" | "transunion"
      paige_booking_event_type:
        | "vip_intro"
        | "dfy_discovery"
        | "coffee_hour"
        | "workshop"
        | "other"
      paige_booking_status:
        | "confirmed"
        | "canceled"
        | "rescheduled"
        | "no_show"
        | "completed"
      paige_enrichment_subject_type: "person" | "company"
      paige_envelope_status:
        | "sent"
        | "delivered"
        | "completed"
        | "declined"
        | "voided"
      paige_envelope_type:
        | "vip_app"
        | "coach_agreement"
        | "dfy_engagement"
        | "refund"
        | "term_sheet"
        | "other"
      paige_social_platform: "facebook" | "instagram"
      paige_social_post_status: "scheduled" | "posted" | "failed" | "deleted"
      task_status: "pending" | "in_progress" | "completed" | "cancelled"
      tenant_role: "owner" | "admin" | "coach" | "member"
      tenant_status: "trial" | "active" | "past_due" | "canceled" | "suspended"
      workflow_provider:
        | "n8n"
        | "langgraph"
        | "direct_edge_function"
        | "cron_only"
        | "langgraph_bridge"
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
      access_tier: ["god", "agency", "tenant", "subaccount", "client", "none"],
      account_type: [
        "credit_card",
        "auto_loan",
        "mortgage",
        "personal_loan",
        "student_loan",
        "collections",
      ],
      app_role: [
        "admin",
        "moderator",
        "user",
        "affiliate",
        "coach",
        "broker",
        "broker_team_member",
        "super_admin",
        "sales_rep",
        "cs_rep",
        "finance",
        "viewer",
        "client",
        "developer",
        "platform_admin",
      ],
      business_hierarchy_type: [
        "holding",
        "parent",
        "subsidiary",
        "standalone",
      ],
      client_file_visibility: ["internal", "shared", "client_upload"],
      consent_type: [
        "credit_report_access",
        "croa_rights",
        "data_sharing",
        "offer_display",
        "adverse_action",
      ],
      credit_prediction_confidence: ["high", "medium", "low"],
      credit_prediction_type: [
        "score_drop_warning",
        "score_increase_opportunity",
        "reporting_date_optimization",
        "account_age_risk",
        "utilization_spike_warning",
        "inquiry_strategy",
        "new_account_timing",
        "payment_history_risk",
        "credit_mix_opportunity",
        "funding_window_alert",
      ],
      denial_reason_category: [
        "credit_score_too_low",
        "insufficient_time_in_business",
        "insufficient_revenue",
        "too_much_existing_debt",
        "no_collateral",
        "incomplete_application",
        "industry_restriction",
        "too_many_recent_inquiries",
        "derogatory_items",
        "insufficient_cash_flow",
        "personal_guarantee_declined",
        "entity_structure_issue",
        "other",
      ],
      disclosure_type: [
        "credit_report_access",
        "croa_rights_notice",
        "data_sharing_consent",
        "offer_display_disclaimer",
        "adverse_action_routing",
        "educational_purposes",
      ],
      dispute_status: [
        "draft",
        "submitted",
        "under_review",
        "resolved",
        "rejected",
      ],
      entity_type: ["LLC", "Corporation", "Sole Proprietorship", "Partnership"],
      funding_journey_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "denied",
        "withdrawn",
        "funded",
      ],
      funding_milestone_type: [
        "first_application",
        "first_approval",
        "first_funding",
        "score_threshold_crossed",
        "debt_cleared",
        "business_credit_established",
        "dscr_qualified",
        "sba_eligible",
      ],
      knowledge_category: [
        "framework",
        "principle",
        "practice",
        "model",
        "stage",
        "implementation",
      ],
      letter_status: ["draft", "generated", "sent", "delivered"],
      marketplace_item_status: ["listed", "unlisted", "archived"],
      marketplace_item_type: [
        "skin",
        "skill",
        "kb_pack",
        "tool",
        "portal_surface",
        "automation",
        "bundle",
      ],
      marketplace_origin: ["first_party", "vendor"],
      marketplace_payload_class: ["config_only", "code"],
      marketplace_scope: ["public", "tenant", "agency"],
      marketplace_version_status: [
        "draft",
        "submitted",
        "in_review",
        "changes_requested",
        "approved",
        "published",
        "deprecated",
        "rejected",
      ],
      naics_risk_category: [
        "low_risk",
        "moderate_risk",
        "high_risk",
        "specialized",
      ],
      notification_type: [
        "dispute_update",
        "payment_success",
        "subscription_change",
        "task_reminder",
        "credit_report_ready",
        "welcome",
        "system",
      ],
      order_status: ["pending", "completed", "failed", "refunded"],
      owner_credit_bureau: ["experian", "equifax", "transunion"],
      paige_booking_event_type: [
        "vip_intro",
        "dfy_discovery",
        "coffee_hour",
        "workshop",
        "other",
      ],
      paige_booking_status: [
        "confirmed",
        "canceled",
        "rescheduled",
        "no_show",
        "completed",
      ],
      paige_enrichment_subject_type: ["person", "company"],
      paige_envelope_status: [
        "sent",
        "delivered",
        "completed",
        "declined",
        "voided",
      ],
      paige_envelope_type: [
        "vip_app",
        "coach_agreement",
        "dfy_engagement",
        "refund",
        "term_sheet",
        "other",
      ],
      paige_social_platform: ["facebook", "instagram"],
      paige_social_post_status: ["scheduled", "posted", "failed", "deleted"],
      task_status: ["pending", "in_progress", "completed", "cancelled"],
      tenant_role: ["owner", "admin", "coach", "member"],
      tenant_status: ["trial", "active", "past_due", "canceled", "suspended"],
      workflow_provider: [
        "n8n",
        "langgraph",
        "direct_edge_function",
        "cron_only",
        "langgraph_bridge",
      ],
    },
  },
} as const
