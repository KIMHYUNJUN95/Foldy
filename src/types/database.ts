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
      announcement_comments: {
        Row: {
          announcement_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_comments_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_popup_dismissals: {
        Row: {
          announcement_id: string
          created_at: string
          hide_until: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          hide_until: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          hide_until?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_popup_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_popup_dismissals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_popup_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          created_at: string
          id: string
          organization_id: string
          read_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          id?: string
          organization_id: string
          read_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          read_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          allow_comments: boolean
          archived_at: string | null
          content: string
          created_at: string
          created_by_user_id: string
          id: string
          image_urls: string[]
          is_important: boolean
          is_pinned: boolean
          organization_id: string
          popup_until: string | null
          published_at: string | null
          show_popup_on_app_open: boolean
          status: Database["public"]["Enums"]["announcement_status"]
          target_roles: Database["public"]["Enums"]["organization_role"][]
          target_scope: Database["public"]["Enums"]["announcement_target_scope"]
          title: string
          updated_at: string
        }
        Insert: {
          allow_comments?: boolean
          archived_at?: string | null
          content: string
          created_at?: string
          created_by_user_id: string
          id?: string
          image_urls?: string[]
          is_important?: boolean
          is_pinned?: boolean
          organization_id: string
          popup_until?: string | null
          published_at?: string | null
          show_popup_on_app_open?: boolean
          status?: Database["public"]["Enums"]["announcement_status"]
          target_roles?: Database["public"]["Enums"]["organization_role"][]
          target_scope?: Database["public"]["Enums"]["announcement_target_scope"]
          title: string
          updated_at?: string
        }
        Update: {
          allow_comments?: boolean
          archived_at?: string | null
          content?: string
          created_at?: string
          created_by_user_id?: string
          id?: string
          image_urls?: string[]
          is_important?: boolean
          is_pinned?: boolean
          organization_id?: string
          popup_until?: string | null
          published_at?: string | null
          show_popup_on_app_open?: boolean
          status?: Database["public"]["Enums"]["announcement_status"]
          target_roles?: Database["public"]["Enums"]["organization_role"][]
          target_scope?: Database["public"]["Enums"]["announcement_target_scope"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_leave_baselines: {
        Row: {
          base_amount: number
          baseline_date: string
          bonus_amount: number
          created_at: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_amount?: number
          baseline_date: string
          bonus_amount?: number
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_amount?: number
          baseline_date?: string
          bonus_amount?: number
          created_at?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_leave_baselines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_leave_baselines_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_leave_requests: {
        Row: {
          applicant_name: string
          approved_at: string | null
          approved_by_user_id: string | null
          approved_role: string | null
          balance_override_reason: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          cancelled_reason: string | null
          created_at: string
          days_count: number
          document_number: string | null
          duration_unit: string
          emergency_contact: string
          end_date: string
          id: string
          image_urls: string[]
          leave_type: string
          organization_id: string
          reason: string
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejected_reason: string | null
          start_date: string
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          applicant_name: string
          approved_at?: string | null
          approved_by_user_id?: string | null
          approved_role?: string | null
          balance_override_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          created_at?: string
          days_count: number
          document_number?: string | null
          duration_unit?: string
          emergency_contact: string
          end_date: string
          id?: string
          image_urls?: string[]
          leave_type: string
          organization_id: string
          reason: string
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejected_reason?: string | null
          start_date: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          applicant_name?: string
          approved_at?: string | null
          approved_by_user_id?: string | null
          approved_role?: string | null
          balance_override_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          created_at?: string
          days_count?: number
          document_number?: string | null
          duration_unit?: string
          emergency_contact?: string
          end_date?: string
          id?: string
          image_urls?: string[]
          leave_type?: string
          organization_id?: string
          reason?: string
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejected_reason?: string | null
          start_date?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_leave_requests_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_leave_requests_cancelled_by_user_id_fkey"
            columns: ["cancelled_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_leave_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_leave_requests_rejected_by_user_id_fkey"
            columns: ["rejected_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_leave_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_attempt_logs: {
        Row: {
          accuracy_meters: number | null
          action_type: string
          attempted_at: string
          created_at: string
          device_info: Json
          failure_reason: string | null
          id: string
          latitude: number | null
          longitude: number | null
          method: string
          organization_id: string
          resolved_site_id: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          accuracy_meters?: number | null
          action_type: string
          attempted_at?: string
          created_at?: string
          device_info?: Json
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          method: string
          organization_id: string
          resolved_site_id?: string | null
          success: boolean
          user_id: string
        }
        Update: {
          accuracy_meters?: number | null
          action_type?: string
          attempted_at?: string
          created_at?: string
          device_info?: Json
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          method?: string
          organization_id?: string
          resolved_site_id?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_attempt_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_attempt_logs_resolved_site_id_fkey"
            columns: ["resolved_site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_attempt_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_breaks: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          organization_id: string
          session_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          organization_id: string
          session_id: string
          started_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          organization_id?: string
          session_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_breaks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_breaks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_correction_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          desired_clock_in_at: string | null
          desired_clock_in_site_id: string | null
          desired_clock_out_at: string | null
          desired_clock_out_site_id: string | null
          id: string
          image_urls: string[]
          memo: string | null
          organization_id: string
          reason_type: string
          requested_by_user_id: string
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          session_id: string | null
          status: string
          target_date: string | null
          target_month: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          desired_clock_in_at?: string | null
          desired_clock_in_site_id?: string | null
          desired_clock_out_at?: string | null
          desired_clock_out_site_id?: string | null
          id?: string
          image_urls?: string[]
          memo?: string | null
          organization_id: string
          reason_type: string
          requested_by_user_id: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          session_id?: string | null
          status?: string
          target_date?: string | null
          target_month?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          desired_clock_in_at?: string | null
          desired_clock_in_site_id?: string | null
          desired_clock_out_at?: string | null
          desired_clock_out_site_id?: string | null
          id?: string
          image_urls?: string[]
          memo?: string | null
          organization_id?: string
          reason_type?: string
          requested_by_user_id?: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          session_id?: string | null
          status?: string
          target_date?: string | null
          target_month?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_correction_requests_desired_clock_in_site_id_fkey"
            columns: ["desired_clock_in_site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_desired_clock_out_site_id_fkey"
            columns: ["desired_clock_out_site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_export_logs: {
        Row: {
          created_at: string
          export_scope: string
          exported_by_user_id: string
          id: string
          meta: Json
          organization_id: string
          snapshot_ids: string[]
          target_month: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          export_scope: string
          exported_by_user_id: string
          id?: string
          meta?: Json
          organization_id: string
          snapshot_ids?: string[]
          target_month: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          export_scope?: string
          exported_by_user_id?: string
          id?: string
          meta?: Json
          organization_id?: string
          snapshot_ids?: string[]
          target_month?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_export_logs_exported_by_user_id_fkey"
            columns: ["exported_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_export_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_export_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_month_snapshots: {
        Row: {
          allowance_breakdown: Json
          created_at: string
          finalized_at: string | null
          finalized_by_user_id: string | null
          gross_amount: number
          id: string
          organization_id: string
          rate_breakdown: Json
          status: string
          supersedes_snapshot_id: string | null
          target_month: string
          total_paid_minutes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          allowance_breakdown?: Json
          created_at?: string
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          gross_amount?: number
          id?: string
          organization_id: string
          rate_breakdown?: Json
          status?: string
          supersedes_snapshot_id?: string | null
          target_month: string
          total_paid_minutes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          allowance_breakdown?: Json
          created_at?: string
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          gross_amount?: number
          id?: string
          organization_id?: string
          rate_breakdown?: Json
          status?: string
          supersedes_snapshot_id?: string | null
          target_month?: string
          total_paid_minutes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_month_snapshots_finalized_by_user_id_fkey"
            columns: ["finalized_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_month_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_month_snapshots_supersedes_snapshot_id_fkey"
            columns: ["supersedes_snapshot_id"]
            isOneToOne: false
            referencedRelation: "attendance_month_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_month_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_open_session_reminders: {
        Row: {
          created_at: string
          id: string
          operating_date: string
          organization_id: string
          responded_at: string | null
          response: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          operating_date: string
          organization_id: string
          responded_at?: string | null
          response?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          operating_date?: string
          organization_id?: string
          responded_at?: string | null
          response?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_open_session_reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_open_session_reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_pay_allowances: {
        Row: {
          allowance_type: string
          amount_yen: number
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          category: string
          created_at: string
          created_by_user_id: string
          id: string
          memo: string | null
          organization_id: string
          status: string
          target_date: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          allowance_type: string
          amount_yen: number
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          category?: string
          created_at?: string
          created_by_user_id: string
          id?: string
          memo?: string | null
          organization_id: string
          status?: string
          target_date: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          allowance_type?: string
          amount_yen?: number
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          category?: string
          created_at?: string
          created_by_user_id?: string
          id?: string
          memo?: string | null
          organization_id?: string
          status?: string
          target_date?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_pay_allowances_cancelled_by_user_id_fkey"
            columns: ["cancelled_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_pay_allowances_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_pay_allowances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_pay_allowances_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_qr_tokens: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          is_active: boolean
          issued_at: string
          organization_id: string
          replaced_by_token_id: string | null
          revoked_at: string | null
          site_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          is_active?: boolean
          issued_at?: string
          organization_id: string
          replaced_by_token_id?: string | null
          revoked_at?: string | null
          site_id: string
          token: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          is_active?: boolean
          issued_at?: string
          organization_id?: string
          replaced_by_token_id?: string | null
          revoked_at?: string | null
          site_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_qr_tokens_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_qr_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_qr_tokens_replaced_by_token_id_fkey"
            columns: ["replaced_by_token_id"]
            isOneToOne: false
            referencedRelation: "attendance_qr_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_qr_tokens_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_session_audits: {
        Row: {
          action_type: string
          actor_user_id: string
          after_json: Json
          before_json: Json
          created_at: string
          id: string
          organization_id: string
          reason: string
          session_id: string
        }
        Insert: {
          action_type: string
          actor_user_id: string
          after_json?: Json
          before_json?: Json
          created_at?: string
          id?: string
          organization_id: string
          reason: string
          session_id: string
        }
        Update: {
          action_type?: string
          actor_user_id?: string
          after_json?: Json
          before_json?: Json
          created_at?: string
          id?: string
          organization_id?: string
          reason?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_session_audits_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_session_audits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_session_audits_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          abandoned_at: string | null
          clock_in_accuracy_meters: number | null
          clock_in_at: string | null
          clock_in_device_info: Json
          clock_in_latitude: number | null
          clock_in_longitude: number | null
          clock_in_method: string | null
          clock_in_qr_token_id: string | null
          clock_in_site_id: string | null
          clock_out_accuracy_meters: number | null
          clock_out_at: string | null
          clock_out_device_info: Json
          clock_out_latitude: number | null
          clock_out_longitude: number | null
          clock_out_method: string | null
          clock_out_qr_token_id: string | null
          clock_out_site_id: string | null
          created_at: string
          id: string
          invalidated_at: string | null
          invalidated_by_user_id: string | null
          invalidated_reason: string | null
          manual_created: boolean
          manual_created_by_user_id: string | null
          manual_created_reason: string | null
          manual_location: string | null
          operating_date: string
          organization_id: string
          review_state: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          abandoned_at?: string | null
          clock_in_accuracy_meters?: number | null
          clock_in_at?: string | null
          clock_in_device_info?: Json
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_in_method?: string | null
          clock_in_qr_token_id?: string | null
          clock_in_site_id?: string | null
          clock_out_accuracy_meters?: number | null
          clock_out_at?: string | null
          clock_out_device_info?: Json
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          clock_out_method?: string | null
          clock_out_qr_token_id?: string | null
          clock_out_site_id?: string | null
          created_at?: string
          id?: string
          invalidated_at?: string | null
          invalidated_by_user_id?: string | null
          invalidated_reason?: string | null
          manual_created?: boolean
          manual_created_by_user_id?: string | null
          manual_created_reason?: string | null
          manual_location?: string | null
          operating_date: string
          organization_id: string
          review_state?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          abandoned_at?: string | null
          clock_in_accuracy_meters?: number | null
          clock_in_at?: string | null
          clock_in_device_info?: Json
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_in_method?: string | null
          clock_in_qr_token_id?: string | null
          clock_in_site_id?: string | null
          clock_out_accuracy_meters?: number | null
          clock_out_at?: string | null
          clock_out_device_info?: Json
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          clock_out_method?: string | null
          clock_out_qr_token_id?: string | null
          clock_out_site_id?: string | null
          created_at?: string
          id?: string
          invalidated_at?: string | null
          invalidated_by_user_id?: string | null
          invalidated_reason?: string | null
          manual_created?: boolean
          manual_created_by_user_id?: string | null
          manual_created_reason?: string | null
          manual_location?: string | null
          operating_date?: string
          organization_id?: string
          review_state?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_clock_in_qr_token_id_fkey"
            columns: ["clock_in_qr_token_id"]
            isOneToOne: false
            referencedRelation: "attendance_qr_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_clock_in_site_id_fkey"
            columns: ["clock_in_site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_clock_out_qr_token_id_fkey"
            columns: ["clock_out_qr_token_id"]
            isOneToOne: false
            referencedRelation: "attendance_qr_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_clock_out_site_id_fkey"
            columns: ["clock_out_site_id"]
            isOneToOne: false
            referencedRelation: "attendance_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_invalidated_by_user_id_fkey"
            columns: ["invalidated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_manual_created_by_user_id_fkey"
            columns: ["manual_created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sites: {
        Row: {
          allowed_radius_meters: number
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          organization_id: string
          print_name: string | null
          property_id: string | null
          updated_at: string
          wifi_ssids: string[]
        }
        Insert: {
          allowed_radius_meters?: number
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name: string
          organization_id: string
          print_name?: string | null
          property_id?: string | null
          updated_at?: string
          wifi_ssids?: string[]
        }
        Update: {
          allowed_radius_meters?: number
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          organization_id?: string
          print_name?: string | null
          property_id?: string | null
          updated_at?: string
          wifi_ssids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_trusted_devices: {
        Row: {
          created_at: string
          device_label: string | null
          expires_at: string
          id: string
          last_used_at: string
          organization_id: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          expires_at: string
          id?: string
          last_used_at?: string
          organization_id: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_trusted_devices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_trusted_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          organization_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beds24_block_logs: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          end_date: string
          external_room_ids: string[]
          id: string
          nights: number | null
          organization_id: string
          property_name: string | null
          reason: string | null
          purpose: string | null
          memo: string | null
          requested_by: string | null
          requested_by_name: string | null
          room_label: string | null
          start_date: string
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          end_date: string
          external_room_ids?: string[]
          id?: string
          nights?: number | null
          organization_id: string
          property_name?: string | null
          reason?: string | null
          purpose?: string | null
          memo?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          room_label?: string | null
          start_date: string
          status: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          end_date?: string
          external_room_ids?: string[]
          id?: string
          nights?: number | null
          organization_id?: string
          property_name?: string | null
          reason?: string | null
          purpose?: string | null
          memo?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          room_label?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds24_block_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beds24_deferred_refreshes: {
        Row: {
          attempts: number
          external_property_id: string
          last_error: string | null
          organization_id: string
          reason: string
          requested_at: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          external_property_id: string
          last_error?: string | null
          organization_id: string
          reason: string
          requested_at?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          external_property_id?: string
          last_error?: string | null
          organization_id?: string
          reason?: string
          requested_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds24_deferred_refreshes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beds24_price_jobs: {
        Row: {
          adjust_mode: string | null
          attempt_count: number
          completed_at: string | null
          created_at: string
          error: string | null
          failed_room_ids: string[]
          id: string
          job_type: string
          organization_id: string
          percent_value: number | null
          processed_count: number
          property_id: string | null
          requested_by: string | null
          requested_by_name: string | null
          results: Json
          room_updates: Json
          started_at: string | null
          status: string
          total_count: number
          updated_at: string
        }
        Insert: {
          adjust_mode?: string | null
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_room_ids?: string[]
          id?: string
          job_type: string
          organization_id: string
          percent_value?: number | null
          processed_count?: number
          property_id?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          results?: Json
          room_updates: Json
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          adjust_mode?: string | null
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_room_ids?: string[]
          id?: string
          job_type?: string
          organization_id?: string
          percent_value?: number | null
          processed_count?: number
          property_id?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          results?: Json
          room_updates?: Json
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds24_price_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds24_price_jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds24_price_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      beds24_sync_locks: {
        Row: {
          expires_at: string
          locked_at: string
          locked_by: string | null
          metadata: Json
          name: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          expires_at: string
          locked_at?: string
          locked_by?: string | null
          metadata?: Json
          name: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          expires_at?: string
          locked_at?: string
          locked_by?: string | null
          metadata?: Json
          name?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      beds24_sync_state: {
        Row: {
          id: boolean
          last_full_sweep_at: string | null
          last_modified_cursor: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_full_sweep_at?: string | null
          last_modified_cursor?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_full_sweep_at?: string | null
          last_modified_cursor?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      beds24_webhook_events: {
        Row: {
          booking_summary: Json
          content_type: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          failed_count: number
          http_status: number | null
          id: string
          modes: string[]
          organization_id: string | null
          processed_count: number
          raw_payload: Json | null
          received_at: string
          succeeded_count: number
          trigger_source: string
        }
        Insert: {
          booking_summary?: Json
          content_type?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          failed_count?: number
          http_status?: number | null
          id?: string
          modes?: string[]
          organization_id?: string | null
          processed_count?: number
          raw_payload?: Json | null
          received_at?: string
          succeeded_count?: number
          trigger_source?: string
        }
        Update: {
          booking_summary?: Json
          content_type?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          failed_count?: number
          http_status?: number | null
          id?: string
          modes?: string[]
          organization_id?: string | null
          processed_count?: number
          raw_payload?: Json | null
          received_at?: string
          succeeded_count?: number
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds24_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_destinations: {
        Row: {
          channel_key: string
          created_at: string
          id: string
          job_key: string
          locales: string[]
          organization_id: string
          updated_at: string
        }
        Insert: {
          channel_key: string
          created_at?: string
          id?: string
          job_key: string
          locales: string[]
          organization_id: string
          updated_at?: string
        }
        Update: {
          channel_key?: string
          created_at?: string
          id?: string
          job_key?: string
          locales?: string[]
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_destinations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          created_at: string
          enabled: boolean
          enabled_at: string | null
          event_cursor: string | null
          id: string
          job_key: string
          last_done_on: string | null
          next_wake_at: string | null
          organization_id: string
          retry_until: string
          send_time: string
          settings: Json
          updated_at: string
          updated_by: string | null
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          event_cursor?: string | null
          id?: string
          job_key: string
          last_done_on?: string | null
          next_wake_at?: string | null
          organization_id: string
          retry_until?: string
          send_time?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          event_cursor?: string | null
          id?: string
          job_key?: string
          last_done_on?: string | null
          next_wake_at?: string | null
          organization_id?: string
          retry_until?: string
          send_time?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "automation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          actor_id: string | null
          channel_key: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          job_key: string
          locale: string | null
          message: string | null
          message_hash: string | null
          meta: Json
          organization_id: string
          reason: string | null
          status: string
          target_date: string | null
          trigger: string
        }
        Insert: {
          actor_id?: string | null
          channel_key?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          job_key: string
          locale?: string | null
          message?: string | null
          message_hash?: string | null
          meta?: Json
          organization_id: string
          reason?: string | null
          status: string
          target_date?: string | null
          trigger: string
        }
        Update: {
          actor_id?: string | null
          channel_key?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          job_key?: string
          locale?: string | null
          message?: string | null
          message_hash?: string | null
          meta?: Json
          organization_id?: string
          reason?: string | null
          status?: string
          target_date?: string | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_setting_logs: {
        Row: {
          actor_id: string | null
          changes: Json
          created_at: string
          id: string
          job_key: string
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          job_key: string
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          job_key?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_setting_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      board_comments: {
        Row: {
          content: string
          created_at: string
          created_by_user_id: string
          deleted_at: string | null
          id: string
          image_urls: string[]
          mention_all: boolean
          mentioned_user_ids: string[]
          organization_id: string
          post_id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by_user_id: string
          deleted_at?: string | null
          id?: string
          image_urls?: string[]
          mention_all?: boolean
          mentioned_user_ids?: string[]
          organization_id: string
          post_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by_user_id?: string
          deleted_at?: string | null
          id?: string
          image_urls?: string[]
          mention_all?: boolean
          mentioned_user_ids?: string[]
          organization_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_comments_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "board_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      board_post_reads: {
        Row: {
          post_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          post_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_post_reads_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "board_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_post_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_posts: {
        Row: {
          allow_comments: boolean
          content: string
          created_at: string
          created_by_user_id: string
          deleted_at: string | null
          file_attachments: Json
          id: string
          image_urls: string[]
          is_pinned: boolean
          organization_id: string
          pinned_at: string | null
          pinned_by_user_id: string | null
          tags: string[]
          title: string | null
          updated_at: string
        }
        Insert: {
          allow_comments?: boolean
          content: string
          created_at?: string
          created_by_user_id: string
          deleted_at?: string | null
          file_attachments?: Json
          id?: string
          image_urls?: string[]
          is_pinned?: boolean
          organization_id: string
          pinned_at?: string | null
          pinned_by_user_id?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Update: {
          allow_comments?: boolean
          content?: string
          created_at?: string
          created_by_user_id?: string
          deleted_at?: string | null
          file_attachments?: Json
          id?: string
          image_urls?: string[]
          is_pinned?: boolean
          organization_id?: string
          pinned_at?: string | null
          pinned_by_user_id?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_posts_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_posts_pinned_by_user_id_fkey"
            columns: ["pinned_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_reactions: {
        Row: {
          created_at: string
          emoji: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "board_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_reports: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          note: string | null
          organization_id: string
          post_id: string
          reason: string
          reporter_user_id: string
          resolved_at: string | null
          resolved_by_user_id: string | null
          status: string
          target_author_user_id: string | null
          target_type: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          post_id: string
          reason: string
          reporter_user_id: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
          target_author_user_id?: string | null
          target_type: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          post_id?: string
          reason?: string
          reporter_user_id?: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
          target_author_user_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          closed_at: string | null
          closed_by_user_id: string | null
          created_at: string
          description: string
          id: string
          image_urls: string[]
          organization_id: string
          reported_by_user_id: string
          reviewed_by_user_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          description: string
          id?: string
          image_urls?: string[]
          organization_id: string
          reported_by_user_id: string
          reviewed_by_user_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          description?: string
          id?: string
          image_urls?: string[]
          organization_id?: string
          reported_by_user_id?: string
          reviewed_by_user_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_closed_by_user_id_fkey"
            columns: ["closed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_roles: {
        Row: {
          capability: string
          role: Database["public"]["Enums"]["organization_role"]
        }
        Insert: {
          capability: string
          role: Database["public"]["Enums"]["organization_role"]
        }
        Update: {
          capability?: string
          role?: Database["public"]["Enums"]["organization_role"]
        }
        Relationships: []
      }
      cleaning_list_assignees: {
        Row: {
          assign_date: string
          names: string
          organization_id: string
          room_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assign_date: string
          names: string
          organization_id: string
          room_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assign_date?: string
          names?: string
          organization_id?: string
          room_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_list_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_list_extra_rooms: {
        Row: {
          created_at: string
          created_by: string | null
          note: string | null
          organization_id: string
          property_name: string
          room_key: string
          room_label: string
          target_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          organization_id: string
          property_name: string
          room_key: string
          room_label: string
          target_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          organization_id?: string
          property_name?: string
          room_key?: string
          room_label?: string
          target_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_list_extra_rooms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_sessions: {
        Row: {
          cleaning_date: string
          completed_at: string | null
          completed_by_admin: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          notes: string | null
          organization_id: string
          room_label: string
          staff_user_id: string
          started_at: string
          status: Database["public"]["Enums"]["cleaning_status"]
          task_label: string
          updated_at: string
        }
        Insert: {
          cleaning_date?: string
          completed_at?: string | null
          completed_by_admin?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          room_label: string
          staff_user_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["cleaning_status"]
          task_label: string
          updated_at?: string
        }
        Update: {
          cleaning_date?: string
          completed_at?: string | null
          completed_by_admin?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          room_label?: string
          staff_user_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["cleaning_status"]
          task_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_sessions_completed_by_admin_fkey"
            columns: ["completed_by_admin"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_sessions_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      complaint_comments: {
        Row: {
          complaint_id: string
          content: string
          created_at: string
          created_by_user_id: string
          deleted_at: string | null
          id: string
          image_urls: string[]
          organization_id: string
          updated_at: string
        }
        Insert: {
          complaint_id: string
          content: string
          created_at?: string
          created_by_user_id: string
          deleted_at?: string | null
          id?: string
          image_urls?: string[]
          organization_id: string
          updated_at?: string
        }
        Update: {
          complaint_id?: string
          content?: string
          created_at?: string
          created_by_user_id?: string
          deleted_at?: string | null
          id?: string
          image_urls?: string[]
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaint_comments_complaint_id_fkey"
            columns: ["complaint_id"]
            isOneToOne: false
            referencedRelation: "customer_complaints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaint_comments_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaint_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_complaints: {
        Row: {
          created_at: string
          created_by_user_id: string
          description: string | null
          external_review_id: string | null
          external_review_snapshot: Json | null
          guest_name: string | null
          id: string
          image_urls: string[]
          organization_id: string
          platform: string
          platform_ref: string | null
          property_id: string | null
          property_name: string | null
          rating: number | null
          reservation_id: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          room_id: string | null
          room_label: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          description?: string | null
          external_review_id?: string | null
          external_review_snapshot?: Json | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          organization_id: string
          platform: string
          platform_ref?: string | null
          property_id?: string | null
          property_name?: string | null
          rating?: number | null
          reservation_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          room_id?: string | null
          room_label?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          external_review_id?: string | null
          external_review_snapshot?: Json | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          organization_id?: string
          platform?: string
          platform_ref?: string | null
          property_id?: string | null
          property_name?: string | null
          rating?: number | null
          reservation_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          room_id?: string | null
          room_label?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_complaints_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_external_review_id_fkey"
            columns: ["external_review_id"]
            isOneToOne: false
            referencedRelation: "external_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_complaints_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_type_history: {
        Row: {
          created_at: string
          created_by_user_id: string
          effective_from: string
          effective_to: string | null
          employment_type: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          effective_from: string
          effective_to?: string | null
          employment_type: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          effective_from?: string
          effective_to?: string | null
          employment_type?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_type_history_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_type_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_type_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      external_reviews: {
        Row: {
          created_at: string
          external_review_id: string
          guest_display_name: string | null
          headline: string | null
          id: string
          imported_at: string
          linked_complaint_id: string | null
          negative_review_text: string | null
          organization_id: string
          ota_replied_at: string | null
          ota_reply_text: string | null
          positive_review_text: string | null
          private_feedback: string | null
          property_id: string | null
          property_name: string | null
          provider: string
          rating_breakdown: Json
          rating_scale: number | null
          rating_value: number | null
          raw_payload: Json
          reservation_id: string | null
          review_text: string | null
          reviewed_at: string | null
          risk_level: string
          room_id: string | null
          room_label: string | null
          source_language_code: string | null
          source_reservation_id: string | null
          source_updated_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_review_id: string
          guest_display_name?: string | null
          headline?: string | null
          id?: string
          imported_at?: string
          linked_complaint_id?: string | null
          negative_review_text?: string | null
          organization_id: string
          ota_replied_at?: string | null
          ota_reply_text?: string | null
          positive_review_text?: string | null
          private_feedback?: string | null
          property_id?: string | null
          property_name?: string | null
          provider: string
          rating_breakdown?: Json
          rating_scale?: number | null
          rating_value?: number | null
          raw_payload?: Json
          reservation_id?: string | null
          review_text?: string | null
          reviewed_at?: string | null
          risk_level?: string
          room_id?: string | null
          room_label?: string | null
          source_language_code?: string | null
          source_reservation_id?: string | null
          source_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_review_id?: string
          guest_display_name?: string | null
          headline?: string | null
          id?: string
          imported_at?: string
          linked_complaint_id?: string | null
          negative_review_text?: string | null
          organization_id?: string
          ota_replied_at?: string | null
          ota_reply_text?: string | null
          positive_review_text?: string | null
          private_feedback?: string | null
          property_id?: string | null
          property_name?: string | null
          provider?: string
          rating_breakdown?: Json
          rating_scale?: number | null
          rating_value?: number | null
          raw_payload?: Json
          reservation_id?: string | null
          review_text?: string | null
          reviewed_at?: string | null
          risk_level?: string
          room_id?: string | null
          room_label?: string | null
          source_language_code?: string | null
          source_reservation_id?: string | null
          source_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_reviews_linked_complaint_id_fkey"
            columns: ["linked_complaint_id"]
            isOneToOne: false
            referencedRelation: "customer_complaints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_reviews_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_reviews_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_rate_history: {
        Row: {
          created_at: string
          created_by_user_id: string
          effective_from: string
          effective_to: string | null
          hourly_rate: number
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          effective_from: string
          effective_to?: string | null
          hourly_rate: number
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          effective_from?: string
          effective_to?: string | null
          hourly_rate?: number
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hourly_rate_history_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_rate_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_rate_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by_user_id: string | null
          default_role: Database["public"]["Enums"]["organization_role"]
          expires_at: string
          id: string
          is_active: boolean
          max_uses: number
          name: string
          organization_id: string
          updated_at: string
          used_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by_user_id?: string | null
          default_role: Database["public"]["Enums"]["organization_role"]
          expires_at: string
          id?: string
          is_active?: boolean
          max_uses: number
          name: string
          organization_id: string
          updated_at?: string
          used_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          default_role?: Database["public"]["Enums"]["organization_role"]
          expires_at?: string
          id?: string
          is_active?: boolean
          max_uses?: number
          name?: string
          organization_id?: string
          updated_at?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          address: string | null
          age: string | null
          applicant_name: string
          applied_at: string | null
          applied_position: string | null
          commute_time: string | null
          created_at: string
          days_per_week: string | null
          duration: string | null
          employment_type: string | null
          external_id: string
          gender: string | null
          has_industry_exp: string | null
          id: string
          imported_at: string
          industry_tasks: string[]
          job_external_id: string | null
          job_title: string | null
          kakao_id: string | null
          motivation: string | null
          nationality: string | null
          organization_id: string
          phone: string | null
          raw_payload: Json
          resume_file_name: string | null
          resume_path: string | null
          resume_source_url: string | null
          review_note: string | null
          source: string
          source_channel: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["job_application_status"]
          status_changed_at: string | null
          status_changed_by_user_id: string | null
          uniform_size: string | null
          updated_at: string
          visa_period: string | null
          visa_type: string | null
          work_days: string[]
        }
        Insert: {
          address?: string | null
          age?: string | null
          applicant_name: string
          applied_at?: string | null
          applied_position?: string | null
          commute_time?: string | null
          created_at?: string
          days_per_week?: string | null
          duration?: string | null
          employment_type?: string | null
          external_id: string
          gender?: string | null
          has_industry_exp?: string | null
          id?: string
          imported_at?: string
          industry_tasks?: string[]
          job_external_id?: string | null
          job_title?: string | null
          kakao_id?: string | null
          motivation?: string | null
          nationality?: string | null
          organization_id: string
          phone?: string | null
          raw_payload?: Json
          resume_file_name?: string | null
          resume_path?: string | null
          resume_source_url?: string | null
          review_note?: string | null
          source?: string
          source_channel?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["job_application_status"]
          status_changed_at?: string | null
          status_changed_by_user_id?: string | null
          uniform_size?: string | null
          updated_at?: string
          visa_period?: string | null
          visa_type?: string | null
          work_days?: string[]
        }
        Update: {
          address?: string | null
          age?: string | null
          applicant_name?: string
          applied_at?: string | null
          applied_position?: string | null
          commute_time?: string | null
          created_at?: string
          days_per_week?: string | null
          duration?: string | null
          employment_type?: string | null
          external_id?: string
          gender?: string | null
          has_industry_exp?: string | null
          id?: string
          imported_at?: string
          industry_tasks?: string[]
          job_external_id?: string | null
          job_title?: string | null
          kakao_id?: string | null
          motivation?: string | null
          nationality?: string | null
          organization_id?: string
          phone?: string | null
          raw_payload?: Json
          resume_file_name?: string | null
          resume_path?: string | null
          resume_source_url?: string | null
          review_note?: string | null
          source?: string
          source_channel?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["job_application_status"]
          status_changed_at?: string | null
          status_changed_by_user_id?: string | null
          uniform_size?: string | null
          updated_at?: string
          visa_period?: string | null
          visa_type?: string | null
          work_days?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_status_changed_by_user_id_fkey"
            columns: ["status_changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_deletions: {
        Row: {
          deleted_at: string
          deleted_by_user_id: string | null
          external_id: string
          organization_id: string
          source: string
        }
        Insert: {
          deleted_at?: string
          deleted_by_user_id?: string | null
          external_id: string
          organization_id: string
          source: string
        }
        Update: {
          deleted_at?: string
          deleted_by_user_id?: string | null
          external_id?: string
          organization_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_application_deletions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linen_items: {
        Row: {
          building_name: string | null
          category: string | null
          code: string | null
          created_at: string
          created_by_user_id: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          building_name?: string | null
          category?: string | null
          code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          building_name?: string | null
          category?: string | null
          code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linen_items_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linen_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linen_return_record_items: {
        Row: {
          created_at: string
          id: string
          linen_item_id: string
          quantity: number
          return_record_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          linen_item_id: string
          quantity: number
          return_record_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          linen_item_id?: string
          quantity?: number
          return_record_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "linen_return_record_items_linen_item_id_fkey"
            columns: ["linen_item_id"]
            isOneToOne: false
            referencedRelation: "linen_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linen_return_record_items_return_record_id_fkey"
            columns: ["return_record_id"]
            isOneToOne: false
            referencedRelation: "linen_return_records"
            referencedColumns: ["id"]
          },
        ]
      }
      linen_return_records: {
        Row: {
          building_name: string
          created_at: string
          id: string
          image_urls: string[]
          note: string | null
          organization_id: string
          registered_at: string
          registered_by_user_id: string
          updated_at: string
        }
        Insert: {
          building_name: string
          created_at?: string
          id?: string
          image_urls?: string[]
          note?: string | null
          organization_id: string
          registered_at?: string
          registered_by_user_id: string
          updated_at?: string
        }
        Update: {
          building_name?: string
          created_at?: string
          id?: string
          image_urls?: string[]
          note?: string | null
          organization_id?: string
          registered_at?: string
          registered_by_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linen_return_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linen_return_records_registered_by_user_id_fkey"
            columns: ["registered_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lost_items: {
        Row: {
          category: Database["public"]["Enums"]["lost_item_category"]
          cleaning_session_id: string | null
          created_at: string
          found_at: string
          guest_name: string | null
          handled_at: string | null
          handled_by: string | null
          handled_by_admin: boolean
          handling_image_urls: string[]
          handling_memo: string | null
          hold_reason: string | null
          hold_until: string | null
          id: string
          image_urls: string[]
          item_name: string
          memo: string | null
          organization_id: string
          property_name: string | null
          reported_by_user_id: string
          reservation_id: string | null
          return_method:
            | Database["public"]["Enums"]["lost_return_method"]
            | null
          return_tracking_no: string | null
          room_label: string
          status: Database["public"]["Enums"]["lost_item_status"]
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["lost_item_category"]
          cleaning_session_id?: string | null
          created_at?: string
          found_at?: string
          guest_name?: string | null
          handled_at?: string | null
          handled_by?: string | null
          handled_by_admin?: boolean
          handling_image_urls?: string[]
          handling_memo?: string | null
          hold_reason?: string | null
          hold_until?: string | null
          id?: string
          image_urls?: string[]
          item_name: string
          memo?: string | null
          organization_id: string
          property_name?: string | null
          reported_by_user_id: string
          reservation_id?: string | null
          return_method?:
            | Database["public"]["Enums"]["lost_return_method"]
            | null
          return_tracking_no?: string | null
          room_label: string
          status?: Database["public"]["Enums"]["lost_item_status"]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["lost_item_category"]
          cleaning_session_id?: string | null
          created_at?: string
          found_at?: string
          guest_name?: string | null
          handled_at?: string | null
          handled_by?: string | null
          handled_by_admin?: boolean
          handling_image_urls?: string[]
          handling_memo?: string | null
          hold_reason?: string | null
          hold_until?: string | null
          id?: string
          image_urls?: string[]
          item_name?: string
          memo?: string | null
          organization_id?: string
          property_name?: string | null
          reported_by_user_id?: string
          reservation_id?: string | null
          return_method?:
            | Database["public"]["Enums"]["lost_return_method"]
            | null
          return_tracking_no?: string | null
          room_label?: string
          status?: Database["public"]["Enums"]["lost_item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lost_items_cleaning_session_id_fkey"
            columns: ["cleaning_session_id"]
            isOneToOne: false
            referencedRelation: "cleaning_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_items_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_items_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_reports: {
        Row: {
          category: Database["public"]["Enums"]["maintenance_category"]
          cleaning_session_id: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_admin: boolean
          created_at: string
          description: string | null
          guest_name: string | null
          id: string
          image_urls: string[]
          is_building_only: boolean
          issue_title: string
          organization_id: string
          priority: Database["public"]["Enums"]["maintenance_priority"]
          property_name: string | null
          reported_by_user_id: string
          reservation_id: string | null
          resolution_image_urls: string[]
          resolution_memo: string | null
          room_label: string
          status: Database["public"]["Enums"]["maintenance_status"]
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["maintenance_category"]
          cleaning_session_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_admin?: boolean
          created_at?: string
          description?: string | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          is_building_only?: boolean
          issue_title: string
          organization_id: string
          priority?: Database["public"]["Enums"]["maintenance_priority"]
          property_name?: string | null
          reported_by_user_id: string
          reservation_id?: string | null
          resolution_image_urls?: string[]
          resolution_memo?: string | null
          room_label: string
          status?: Database["public"]["Enums"]["maintenance_status"]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["maintenance_category"]
          cleaning_session_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_admin?: boolean
          created_at?: string
          description?: string | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          is_building_only?: boolean
          issue_title?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["maintenance_priority"]
          property_name?: string | null
          reported_by_user_id?: string
          reservation_id?: string | null
          resolution_image_urls?: string[]
          resolution_memo?: string | null
          room_label?: string
          status?: Database["public"]["Enums"]["maintenance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_reports_cleaning_session_id_fkey"
            columns: ["cleaning_session_id"]
            isOneToOne: false
            referencedRelation: "cleaning_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reports_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reports_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reports_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_permission_overrides: {
        Row: {
          created_at: string
          effect: string
          expires_at: string | null
          granted_by_user_id: string | null
          id: string
          organization_id: string
          permission_key: string
          reason: string
          revoked_at: string | null
          revoked_by_user_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          effect?: string
          expires_at?: string | null
          granted_by_user_id?: string | null
          id?: string
          organization_id: string
          permission_key: string
          reason: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          effect?: string
          expires_at?: string | null
          granted_by_user_id?: string | null
          id?: string
          organization_id?: string
          permission_key?: string
          reason?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_permission_overrides_granted_by_user_id_fkey"
            columns: ["granted_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_permission_overrides_revoked_by_user_id_fkey"
            columns: ["revoked_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_permission_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          attendance_payroll_admin: boolean
          created_at: string
          id: string
          joined_at: string | null
          leave_approver_role: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status: Database["public"]["Enums"]["membership_status"]
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance_payroll_admin?: boolean
          created_at?: string
          id?: string
          joined_at?: string | null
          leave_approver_role?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance_payroll_admin?: boolean
          created_at?: string
          id?: string
          joined_at?: string | null
          leave_approver_role?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string
          href: string
          id: string
          organization_id: string
          payload: Json
          read_at: string | null
          recipient_user_id: string
          source_id: string
          source_type: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          href: string
          id?: string
          organization_id: string
          payload?: Json
          read_at?: string | null
          recipient_user_id: string
          source_id: string
          source_type: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          href?: string
          id?: string
          organization_id?: string
          payload?: Json
          read_at?: string | null
          recipient_user_id?: string
          source_id?: string
          source_type?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_requests: {
        Row: {
          admin_memo: string | null
          building_name: string
          created_at: string
          delivery_date: string | null
          delivery_end_date: string | null
          delivery_start_date: string | null
          description: string | null
          id: string
          items: Json
          organization_id: string
          reason: string | null
          reported_by_user_id: string
          room_label: string
          status: Database["public"]["Enums"]["order_request_status"]
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["order_request_urgency"]
        }
        Insert: {
          admin_memo?: string | null
          building_name: string
          created_at?: string
          delivery_date?: string | null
          delivery_end_date?: string | null
          delivery_start_date?: string | null
          description?: string | null
          id?: string
          items?: Json
          organization_id: string
          reason?: string | null
          reported_by_user_id: string
          room_label?: string
          status?: Database["public"]["Enums"]["order_request_status"]
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["order_request_urgency"]
        }
        Update: {
          admin_memo?: string | null
          building_name?: string
          created_at?: string
          delivery_date?: string | null
          delivery_end_date?: string | null
          delivery_start_date?: string | null
          description?: string | null
          id?: string
          items?: Json
          organization_id?: string
          reason?: string | null
          reported_by_user_id?: string
          room_label?: string
          status?: Database["public"]["Enums"]["order_request_status"]
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["order_request_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "order_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_manual_booking_requests: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string | null
          organization_id: string
          request_key: string
          reservation_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          organization_id: string
          request_key: string
          reservation_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          organization_id?: string
          request_key?: string
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_manual_booking_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_room_month_stats: {
        Row: {
          organization_id: string
          month: string
          room_key: string
          property_name: string
          room_label: string
          in_catalog: boolean
          revenue: number
          commission: number
          occupied_nights: number
          available_nights: number
          airbnb: number
          booking: number
          direct: number
          other: number
          first_check_in: string | null
        }
        Insert: {
          organization_id: string
          month: string
          room_key: string
          property_name: string
          room_label: string
          in_catalog: boolean
          revenue?: number
          commission?: number
          occupied_nights?: number
          available_nights?: number
          airbnb?: number
          booking?: number
          direct?: number
          other?: number
          first_check_in?: string | null
        }
        Update: {
          organization_id?: string
          month?: string
          room_key?: string
          property_name?: string
          room_label?: string
          in_catalog?: boolean
          revenue?: number
          commission?: number
          occupied_nights?: number
          available_nights?: number
          airbnb?: number
          booking?: number
          direct?: number
          other?: number
          first_check_in?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_room_month_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_stats_months: {
        Row: {
          organization_id: string
          month: string
          version: number
          dirty: boolean
          dirty_at: string
          built_at: string | null
        }
        Insert: {
          organization_id: string
          month: string
          version?: number
          dirty?: boolean
          dirty_at?: string
          built_at?: string | null
        }
        Update: {
          organization_id?: string
          month?: string
          version?: number
          dirty?: boolean
          dirty_at?: string
          built_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_stats_months_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string | null
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_change_logs: {
        Row: {
          adjust_mode: string | null
          changed_by: string | null
          changed_by_name: string | null
          created_at: string
          external_room_id: string
          field: string
          id: string
          job_id: string | null
          new_value: number | null
          old_value: number | null
          organization_id: string
          percent_value: number | null
          room_id: string | null
          room_label: string | null
          stay_date: string
        }
        Insert: {
          adjust_mode?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          external_room_id: string
          field: string
          id?: string
          job_id?: string | null
          new_value?: number | null
          old_value?: number | null
          organization_id: string
          percent_value?: number | null
          room_id?: string | null
          room_label?: string | null
          stay_date: string
        }
        Update: {
          adjust_mode?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          external_room_id?: string
          field?: string
          id?: string
          job_id?: string | null
          new_value?: number | null
          old_value?: number | null
          organization_id?: string
          percent_value?: number | null
          room_id?: string | null
          room_label?: string | null
          stay_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_change_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_change_logs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_change_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "beds24_price_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number | null
          birth_date: string | null
          bottom_nav_tabs: string[]
          can_generate_report: boolean
          created_at: string
          deleted_at: string | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          hire_date: string | null
          id: string
          last_used_organization_id: string | null
          name: string
          ops_calendar_mode: string | null
          phone_number: string
          preferred_language: Database["public"]["Enums"]["app_language"]
          profile_photo_url: string | null
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          updated_at: string
        }
        Insert: {
          age?: number | null
          birth_date?: string | null
          bottom_nav_tabs?: string[]
          can_generate_report?: boolean
          created_at?: string
          deleted_at?: string | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          hire_date?: string | null
          id: string
          last_used_organization_id?: string | null
          name: string
          ops_calendar_mode?: string | null
          phone_number: string
          preferred_language?: Database["public"]["Enums"]["app_language"]
          profile_photo_url?: string | null
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
          updated_at?: string
        }
        Update: {
          age?: number | null
          birth_date?: string | null
          bottom_nav_tabs?: string[]
          can_generate_report?: boolean
          created_at?: string
          deleted_at?: string | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          hire_date?: string | null
          id?: string
          last_used_organization_id?: string | null
          name?: string
          ops_calendar_mode?: string | null
          phone_number?: string
          preferred_language?: Database["public"]["Enums"]["app_language"]
          profile_photo_url?: string | null
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_used_organization_id_fkey"
            columns: ["last_used_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_participants: {
        Row: {
          added_by_user_id: string | null
          created_at: string
          id: string
          is_first_recipient: boolean
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_by_user_id?: string | null
          created_at?: string
          id?: string
          is_first_recipient?: boolean
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          added_by_user_id?: string | null
          created_at?: string
          id?: string
          is_first_recipient?: boolean
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_participants_added_by_user_id_fkey"
            columns: ["added_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_participants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sections: {
        Row: {
          created_at: string
          id: string
          project_id: string
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by_user_id: string
          description: string | null
          id: string
          is_shared: boolean
          organization_id: string
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          description?: string | null
          id?: string
          is_shared?: boolean
          organization_id: string
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          organization_id?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          created_at: string
          display_name_en: string | null
          display_name_ja: string | null
          display_name_ko: string | null
          external_property_id: string | null
          external_provider: string | null
          id: string
          name: string
          organization_id: string
          property_type: Database["public"]["Enums"]["property_type"]
          status: Database["public"]["Enums"]["property_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name_en?: string | null
          display_name_ja?: string | null
          display_name_ko?: string | null
          external_property_id?: string | null
          external_provider?: string | null
          id?: string
          name: string
          organization_id: string
          property_type?: Database["public"]["Enums"]["property_type"]
          status?: Database["public"]["Enums"]["property_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name_en?: string | null
          display_name_ja?: string | null
          display_name_ko?: string | null
          external_property_id?: string | null
          external_provider?: string | null
          id?: string
          name?: string
          organization_id?: string
          property_type?: Database["public"]["Enums"]["property_type"]
          status?: Database["public"]["Enums"]["property_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_operation_infos: {
        Row: {
          address_en: string | null
          address_ja: string | null
          address_ko: string | null
          canonical_name: string
          created_at: string
          id: string
          note: string
          organization_id: string
          room_access: Json
          shared_access: Json
          updated_at: string
        }
        Insert: {
          address_en?: string | null
          address_ja?: string | null
          address_ko?: string | null
          canonical_name: string
          created_at?: string
          id?: string
          note?: string
          organization_id: string
          room_access?: Json
          shared_access?: Json
          updated_at?: string
        }
        Update: {
          address_en?: string | null
          address_ja?: string | null
          address_ko?: string | null
          canonical_name?: string
          created_at?: string
          id?: string
          note?: string
          organization_id?: string
          room_access?: Json
          shared_access?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_operation_infos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recruit_sync_state: {
        Row: {
          id: boolean
          last_result: Json | null
          last_run_at: string | null
          last_success_at: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_result?: Json | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_result?: Json | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reservation_internal_notes: {
        Row: {
          created_at: string
          id: string
          note: string
          organization_id: string
          reservation_id: string
          updated_at: string
          updated_by_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note: string
          organization_id: string
          reservation_id: string
          updated_at?: string
          updated_by_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          organization_id?: string
          reservation_id?: string
          updated_at?: string
          updated_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_internal_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_internal_notes_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_internal_notes_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          check_in_date: string
          check_out_date: string
          created_at: string
          guest_name: string
          id: string
          last_known_amount: number | null
          organization_id: string
          original_reservation_id: string
          property_name: string
          raw_payload: Json
          room_label: string
          source: string
          source_reservation_id: string
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
        }
        Insert: {
          check_in_date: string
          check_out_date: string
          created_at?: string
          guest_name: string
          id?: string
          last_known_amount?: number | null
          organization_id: string
          original_reservation_id?: never
          property_name: string
          raw_payload?: Json
          room_label: string
          source?: string
          source_reservation_id: string
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Update: {
          check_in_date?: string
          check_out_date?: string
          created_at?: string
          guest_name?: string
          id?: string
          last_known_amount?: number | null
          organization_id?: string
          original_reservation_id?: never
          property_name?: string
          raw_payload?: Json
          room_label?: string
          source?: string
          source_reservation_id?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      review_translations: {
        Row: {
          created_at: string
          external_review_id: string
          id: string
          organization_id: string
          provider: string
          source_locale: string | null
          source_part: string
          source_text_hash: string
          target_locale: string
          translated_at: string
          translated_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_review_id: string
          id?: string
          organization_id: string
          provider?: string
          source_locale?: string | null
          source_part: string
          source_text_hash: string
          target_locale: string
          translated_at?: string
          translated_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_review_id?: string
          id?: string
          organization_id?: string
          provider?: string
          source_locale?: string | null
          source_part?: string
          source_text_hash?: string
          target_locale?: string
          translated_at?: string
          translated_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_translations_external_review_id_fkey"
            columns: ["external_review_id"]
            isOneToOne: false
            referencedRelation: "external_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_translations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_block_snapshots: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          end_date: string
          external_room_id: string
          id: string
          organization_id: string
          pre_block_num_avail: Json
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          end_date: string
          external_room_id: string
          id?: string
          organization_id: string
          pre_block_num_avail?: Json
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          end_date?: string
          external_room_id?: string
          id?: string
          organization_id?: string
          pre_block_num_avail?: Json
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_block_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_blocks: {
        Row: {
          created_at: string
          end_date: string
          external_room_id: string | null
          id: string
          organization_id: string
          override_kind: string
          property_name: string
          room_label: string
          source: string
          start_date: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          external_room_id?: string | null
          id?: string
          organization_id: string
          override_kind?: string
          property_name: string
          room_label: string
          source?: string
          start_date: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          external_room_id?: string | null
          id?: string
          organization_id?: string
          override_kind?: string
          property_name?: string
          room_label?: string
          source?: string
          start_date?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_daily_rates: {
        Row: {
          created_at: string
          id: string
          max_stay: number | null
          min_stay: number | null
          num_avail: number | null
          organization_id: string
          override_kind: string | null
          price1: number | null
          price2: number | null
          price3: number | null
          room_id: string
          stay_date: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_stay?: number | null
          min_stay?: number | null
          num_avail?: number | null
          organization_id: string
          override_kind?: string | null
          price1?: number | null
          price2?: number | null
          price3?: number | null
          room_id: string
          stay_date: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_stay?: number | null
          min_stay?: number | null
          num_avail?: number | null
          organization_id?: string
          override_kind?: string | null
          price1?: number | null
          price2?: number | null
          price3?: number | null
          room_id?: string
          stay_date?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_daily_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_daily_rates_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      building_listing_links: {
        Row: {
          canonical_name: string | null
          channel: string
          created_at: string
          guest_url: string | null
          host_url: string | null
          id: string
          listing_id: string | null
          manual_building_id: string | null
          memo: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          canonical_name?: string | null
          channel: string
          created_at?: string
          guest_url?: string | null
          host_url?: string | null
          id?: string
          listing_id?: string | null
          manual_building_id?: string | null
          memo?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          canonical_name?: string | null
          channel?: string
          created_at?: string
          guest_url?: string | null
          host_url?: string | null
          id?: string
          listing_id?: string | null
          manual_building_id?: string | null
          memo?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_listing_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_listing_links_manual_building_id_fkey"
            columns: ["manual_building_id"]
            isOneToOne: false
            referencedRelation: "room_link_buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      room_link_buildings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_link_buildings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_link_rooms: {
        Row: {
          canonical_name: string | null
          created_at: string
          created_by: string | null
          id: string
          manual_building_id: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          canonical_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_building_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_building_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_link_rooms_manual_building_id_fkey"
            columns: ["manual_building_id"]
            isOneToOne: false
            referencedRelation: "room_link_buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_link_rooms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_listing_links: {
        Row: {
          channel: string
          created_at: string
          guest_url: string | null
          host_url: string | null
          id: string
          listing_id: string | null
          manual_room_id: string | null
          memo: string | null
          organization_id: string
          room_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          guest_url?: string | null
          host_url?: string | null
          id?: string
          listing_id?: string | null
          manual_room_id?: string | null
          memo?: string | null
          organization_id: string
          room_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          guest_url?: string | null
          host_url?: string | null
          id?: string
          listing_id?: string | null
          manual_room_id?: string | null
          memo?: string | null
          organization_id?: string
          room_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_listing_links_manual_room_id_fkey"
            columns: ["manual_room_id"]
            isOneToOne: false
            referencedRelation: "room_link_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_listing_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_listing_links_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          external_minimum_stay: number | null
          external_price_source_room_id: string | null
          external_provider: string | null
          external_room_id: string | null
          floor: string | null
          id: string
          name: string
          organization_id: string
          preferred_min_stay_room_id: string | null
          property_id: string
          room_label: string
          status: Database["public"]["Enums"]["room_status"]
          unit_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_minimum_stay?: number | null
          external_price_source_room_id?: string | null
          external_provider?: string | null
          external_room_id?: string | null
          floor?: string | null
          id?: string
          name: string
          organization_id: string
          preferred_min_stay_room_id?: string | null
          property_id: string
          room_label: string
          status?: Database["public"]["Enums"]["room_status"]
          unit_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_minimum_stay?: number | null
          external_price_source_room_id?: string | null
          external_provider?: string | null
          external_room_id?: string | null
          floor?: string | null
          id?: string
          name?: string
          organization_id?: string
          preferred_min_stay_room_id?: string | null
          property_id?: string
          room_label?: string
          status?: Database["public"]["Enums"]["room_status"]
          unit_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_suggestion_comments: {
        Row: {
          body: string | null
          created_at: string
          created_by_user_id: string
          id: string
          image_urls: string[]
          organization_id: string
          suggestion_id: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by_user_id: string
          id?: string
          image_urls?: string[]
          organization_id: string
          suggestion_id: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by_user_id?: string
          id?: string
          image_urls?: string[]
          organization_id?: string
          suggestion_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_suggestion_comments_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_comments_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "staff_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_suggestion_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          organization_id: string
          status: string
          suggestion_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          status: string
          suggestion_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          status?: string
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_suggestion_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_events_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "staff_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_suggestion_references: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          suggestion_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          suggestion_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          suggestion_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_suggestion_references_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_references_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "staff_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestion_references_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_suggestions: {
        Row: {
          body: string
          category: string | null
          completion_note: string | null
          created_at: string
          created_by_user_id: string
          hold_reason: string | null
          id: string
          image_urls: string[]
          organization_id: string
          property_id: string | null
          property_name: string | null
          recipient_user_id: string
          room_id: string | null
          room_label: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          category?: string | null
          completion_note?: string | null
          created_at?: string
          created_by_user_id: string
          hold_reason?: string | null
          id?: string
          image_urls?: string[]
          organization_id: string
          property_id?: string | null
          property_name?: string | null
          recipient_user_id: string
          room_id?: string | null
          room_label?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string | null
          completion_note?: string | null
          created_at?: string
          created_by_user_id?: string
          hold_reason?: string | null
          id?: string
          image_urls?: string[]
          organization_id?: string
          property_id?: string | null
          property_name?: string | null
          recipient_user_id?: string
          room_id?: string | null
          room_label?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_suggestions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_suggestions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      task_occurrence_order: {
        Row: {
          created_at: string
          occurrence_date: string
          organization_id: string
          sort_order: number
          task_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          occurrence_date: string
          organization_id: string
          sort_order: number
          task_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          occurrence_date?: string
          organization_id?: string
          sort_order?: number
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_occurrence_order_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrence_order_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_occurrence_state: {
        Row: {
          completed_by_user_id: string | null
          created_at: string
          moved_to_date: string | null
          occurrence_date: string
          organization_id: string
          state: string
          task_id: string
          updated_at: string
        }
        Insert: {
          completed_by_user_id?: string | null
          created_at?: string
          moved_to_date?: string | null
          occurrence_date: string
          organization_id: string
          state: string
          task_id: string
          updated_at?: string
        }
        Update: {
          completed_by_user_id?: string | null
          created_at?: string
          moved_to_date?: string | null
          occurrence_date?: string
          organization_id?: string
          state?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_occurrence_state_completed_by_user_id_fkey"
            columns: ["completed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrence_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrence_state_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_participants: {
        Row: {
          added_by_user_id: string | null
          created_at: string
          id: string
          is_first_recipient: boolean
          role: string
          task_id: string
          user_id: string
        }
        Insert: {
          added_by_user_id?: string | null
          created_at?: string
          id?: string
          is_first_recipient?: boolean
          role: string
          task_id: string
          user_id: string
        }
        Update: {
          added_by_user_id?: string | null
          created_at?: string
          id?: string
          is_first_recipient?: boolean
          role?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_participants_added_by_user_id_fkey"
            columns: ["added_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_participants_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_updates: {
        Row: {
          body: string | null
          created_at: string
          created_by_user_id: string | null
          id: string
          image_urls: string[]
          task_id: string
          update_type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          image_urls?: string[]
          task_id: string
          update_type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          image_urls?: string[]
          task_id?: string
          update_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_updates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          all_day: boolean
          completed_at: string | null
          completed_by_user_id: string | null
          created_at: string
          created_by_user_id: string
          deleted_at: string | null
          description: string | null
          due_at: string | null
          duration_minutes: number | null
          guest_name: string | null
          id: string
          image_urls: string[]
          is_directive: boolean
          is_inbox: boolean
          is_shared: boolean
          organization_id: string
          priority: string
          project_id: string | null
          property_id: string | null
          recurrence_instance_date: string | null
          recurrence_rule: string | null
          recurrence_series_id: string | null
          reservation_id: string | null
          room_id: string | null
          scheduled_date: string | null
          section_id: string | null
          sort_order: number | null
          status: string
          tags: string[]
          time_label: string | null
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id: string
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          duration_minutes?: number | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          is_directive?: boolean
          is_inbox?: boolean
          is_shared?: boolean
          organization_id: string
          priority?: string
          project_id?: string | null
          property_id?: string | null
          recurrence_instance_date?: string | null
          recurrence_rule?: string | null
          recurrence_series_id?: string | null
          reservation_id?: string | null
          room_id?: string | null
          scheduled_date?: string | null
          section_id?: string | null
          sort_order?: number | null
          status?: string
          tags?: string[]
          time_label?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          duration_minutes?: number | null
          guest_name?: string | null
          id?: string
          image_urls?: string[]
          is_directive?: boolean
          is_inbox?: boolean
          is_shared?: boolean
          organization_id?: string
          priority?: string
          project_id?: string | null
          property_id?: string | null
          recurrence_instance_date?: string | null
          recurrence_rule?: string | null
          recurrence_series_id?: string | null
          reservation_id?: string | null
          room_id?: string | null
          scheduled_date?: string | null
          section_id?: string | null
          sort_order?: number | null
          status?: string
          tags?: string[]
          time_label?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_completed_by_user_id_fkey"
            columns: ["completed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "project_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["team_kind"]
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["team_kind"]
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["team_kind"]
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_reimbursement_item_images: {
        Row: {
          created_at: string
          id: string
          item_id: string
          organization_id: string
          report_id: string
          sort_order: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          organization_id: string
          report_id: string
          sort_order?: number
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          organization_id?: string
          report_id?: string
          sort_order?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_reimbursement_item_images_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "transport_reimbursement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_item_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_item_images_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "transport_reimbursement_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_item_images_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_reimbursement_items: {
        Row: {
          amount_yen: number
          attendance_session_id: string | null
          created_at: string
          entry_mode: string
          id: string
          memo: string | null
          organization_id: string
          property_id: string | null
          report_id: string
          room_id: string | null
          sort_order: number
          updated_at: string
          usage_date: string
          user_id: string
          work_context: Json
        }
        Insert: {
          amount_yen: number
          attendance_session_id?: string | null
          created_at?: string
          entry_mode?: string
          id?: string
          memo?: string | null
          organization_id: string
          property_id?: string | null
          report_id: string
          room_id?: string | null
          sort_order?: number
          updated_at?: string
          usage_date: string
          user_id: string
          work_context?: Json
        }
        Update: {
          amount_yen?: number
          attendance_session_id?: string | null
          created_at?: string
          entry_mode?: string
          id?: string
          memo?: string | null
          organization_id?: string
          property_id?: string | null
          report_id?: string
          room_id?: string | null
          sort_order?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
          work_context?: Json
        }
        Relationships: [
          {
            foreignKeyName: "transport_reimbursement_items_attendance_session_id_fkey"
            columns: ["attendance_session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "transport_reimbursement_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_reimbursement_reports: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          status: string
          submitted_at: string | null
          target_month: string
          total_amount_cached: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          submitted_at?: string | null
          target_month: string
          total_amount_cached?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          submitted_at?: string | null
          target_month?: string
          total_amount_cached?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_reimbursement_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_reports_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_reimbursement_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_user_id: string
          blocker_user_id: string
          created_at: string
          organization_id: string
        }
        Insert: {
          blocked_user_id: string
          blocker_user_id: string
          created_at?: string
          organization_id: string
        }
        Update: {
          blocked_user_id?: string
          blocker_user_id?: string
          created_at?: string
          organization_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_attendance_correction_atomic: {
        Args: {
          p_action_type: string
          p_actor_user_id: string
          p_before_json: Json
          p_comment: string
          p_create_session: boolean
          p_organization_id: string
          p_request_id: string
          p_session_id: string
          p_session_values: Json
        }
        Returns: string
      }
      beds24_release_lock: {
        Args: { p_lock_id: string; p_name: string }
        Returns: boolean
      }
      automation_tick_if_needed: { Args: never; Returns: string }
      automation_tick_token_ok: { Args: { p_token: string }; Returns: boolean }
      beds24_tick_if_needed: { Args: never; Returns: string }
      beds24_tick_token_ok: { Args: { p_token: string }; Returns: boolean }
      beds24_try_lock: {
        Args: {
          p_lock_id: string
          p_locked_by: string
          p_name: string
          p_ttl_ms: number
        }
        Returns: boolean
      }
      can_manage_attendance_payroll: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      can_view_staff_suggestion: {
        Args: { target_suggestion_id: string }
        Returns: boolean
      }
      capability_organization_ids: {
        Args: { target_capability: string }
        Returns: string[]
      }
      create_attendance_session_with_audit: {
        Args: {
          p_action_type: string
          p_actor_user_id: string
          p_organization_id: string
          p_reason: string
          p_values: Json
        }
        Returns: string
      }
      finalize_attendance_month_atomic: {
        Args: {
          p_actor_user_id: string
          p_allowance_breakdown: Json
          p_gross_amount: number
          p_organization_id: string
          p_rate_breakdown: Json
          p_target_month: string
          p_total_paid_minutes: number
          p_user_id: string
        }
        Returns: string
      }
      has_active_membership: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      has_capability: {
        Args: {
          target_capability: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["organization_role"][]
          target_organization_id: string
        }
        Returns: boolean
      }
      has_permission_override: {
        Args: {
          target_organization_id: string
          target_permission_key: string
          target_user_id: string
        }
        Returns: boolean
      }
      is_leave_approver: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_project_participant: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_task_participant: {
        Args: { target_task_id: string }
        Returns: boolean
      }
      issue_attendance_qr: {
        Args: {
          p_created_by: string
          p_org: string
          p_site: string
          p_token: string
        }
        Returns: {
          created_at: string
          created_by_user_id: string
          id: string
          is_active: boolean
          issued_at: string
          organization_id: string
          replaced_by_token_id: string | null
          revoked_at: string | null
          site_id: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_qr_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      join_organization_with_invite_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: {
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status: string
        }[]
      }
      lostfound_auto_dispose: { Args: never; Returns: undefined }
      lostfound_auto_purge: { Args: never; Returns: undefined }
      mutate_attendance_session_with_audit: {
        Args: {
          p_action_type: string
          p_actor_user_id: string
          p_before_json: Json
          p_changes: Json
          p_organization_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: boolean
      }
      reopen_attendance_month_atomic: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_reason: string
          p_snapshot_id: string
          p_target_month: string
          p_user_id: string
        }
        Returns: boolean
      }
      set_annual_leave_baseline_atomic: {
        Args: {
          p_allow_overwrite?: boolean
          p_base_amount: number
          p_baseline_date: string
          p_bonus_amount: number
          p_hire_date: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: string
      }
      set_attendance_history_atomic: {
        Args: {
          p_actor_user_id: string
          p_effective_from: string
          p_employment_type?: string
          p_hourly_rate?: number
          p_kind: string
          p_note?: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: string
      }
      update_staff_suggestion: {
        Args: {
          p_body: string
          p_category: string
          p_id: string
          p_image_urls: string[]
          p_org: string
          p_property_id: string
          p_property_name: string
          p_recipient: string
          p_reference_ids: string[]
          p_room_id: string
          p_room_label: string
          p_title: string
        }
        Returns: string[]
      }
      upsert_room_daily_rates_if_newer: {
        Args: { p_rows: Json }
        Returns: { written_room_id: string; written_stay_date: string }[]
      }
    }
    Enums: {
      announcement_status: "draft" | "published" | "archived"
      announcement_target_scope: "everyone" | "roles"
      app_language: "ko" | "ja" | "en"
      cleaning_status: "in_progress" | "completed" | "cancelled"
      job_application_status: "pending" | "screening" | "interview"
      lost_item_category:
        | "electronics"
        | "wallet"
        | "accessory"
        | "clothing"
        | "document"
        | "bag"
        | "umbrella"
        | "toiletry"
        | "other"
      lost_item_status:
        | "registered"
        | "stored"
        | "disposal_scheduled"
        | "disposed"
        | "returned"
      lost_return_method: "delivery" | "pickup"
      maintenance_category:
        | "electric"
        | "water"
        | "air_conditioning_heating"
        | "wifi"
        | "furniture"
        | "appliance"
        | "cleaning_condition"
        | "supplies"
        | "damage"
        | "other"
      maintenance_priority: "low" | "normal" | "high" | "urgent"
      maintenance_status: "open" | "in_progress" | "closed" | "cancelled"
      membership_status: "invited" | "active" | "suspended" | "removed"
      notification_type:
        | "order_processed"
        | "task_shared"
        | "task_updated"
        | "task_completed"
        | "task_due_soon"
        | "task_overdue"
        | "project_shared"
        | "suggestion_activity"
        | "attendance_activity"
        | "board_activity"
        | "announcement_activity"
        | "bug_report_activity"
      order_request_status:
        | "requested"
        | "approved"
        | "ordered"
        | "received"
        | "closed"
      order_request_urgency: "normal" | "high"
      organization_role:
        | "owner"
        | "office_admin"
        | "cs_staff"
        | "field_manager"
        | "staff"
        | "part_time_staff"
        | "senior_managing_director"
      organization_status: "active" | "suspended" | "archived"
      platform_role: "developer_super_admin"
      profile_gender: "female" | "male"
      property_status: "active" | "inactive" | "under_construction" | "archived"
      property_type:
        | "standalone"
        | "multi_room_building"
        | "hotel"
        | "apartment"
        | "house"
      reservation_status:
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
      room_status: "active" | "inactive" | "under_construction"
      team_kind: "field" | "office"
      theme_preference: "system" | "light" | "dark"
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
  public: {
    Enums: {
      announcement_status: ["draft", "published", "archived"],
      announcement_target_scope: ["everyone", "roles"],
      app_language: ["ko", "ja", "en"],
      cleaning_status: ["in_progress", "completed", "cancelled"],
      job_application_status: ["pending", "screening", "interview"],
      lost_item_category: [
        "electronics",
        "wallet",
        "accessory",
        "clothing",
        "document",
        "bag",
        "umbrella",
        "toiletry",
        "other",
      ],
      lost_item_status: [
        "registered",
        "stored",
        "disposal_scheduled",
        "disposed",
        "returned",
      ],
      lost_return_method: ["delivery", "pickup"],
      maintenance_category: [
        "electric",
        "water",
        "air_conditioning_heating",
        "wifi",
        "furniture",
        "appliance",
        "cleaning_condition",
        "supplies",
        "damage",
        "other",
      ],
      maintenance_priority: ["low", "normal", "high", "urgent"],
      maintenance_status: ["open", "in_progress", "closed", "cancelled"],
      membership_status: ["invited", "active", "suspended", "removed"],
      notification_type: [
        "order_processed",
        "task_shared",
        "task_updated",
        "task_completed",
        "task_due_soon",
        "task_overdue",
        "project_shared",
        "suggestion_activity",
        "attendance_activity",
        "board_activity",
        "announcement_activity",
        "bug_report_activity",
      ],
      order_request_status: [
        "requested",
        "approved",
        "ordered",
        "received",
        "closed",
      ],
      order_request_urgency: ["normal", "high"],
      organization_role: [
        "owner",
        "office_admin",
        "cs_staff",
        "field_manager",
        "staff",
        "part_time_staff",
        "senior_managing_director",
      ],
      organization_status: ["active", "suspended", "archived"],
      platform_role: ["developer_super_admin"],
      profile_gender: ["female", "male"],
      property_status: ["active", "inactive", "under_construction", "archived"],
      property_type: [
        "standalone",
        "multi_room_building",
        "hotel",
        "apartment",
        "house",
      ],
      reservation_status: [
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      room_status: ["active", "inactive", "under_construction"],
      team_kind: ["field", "office"],
      theme_preference: ["system", "light", "dark"],
    },
  },
} as const
