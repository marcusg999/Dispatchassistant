export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: { Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_notes: {
        Row: {
          author_email: string;
          body: string;
          created_at: string;
          id: string;
          suggestion_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_email?: string;
          body: string;
          created_at?: string;
          id?: string;
          suggestion_id: string;
        };
        Update: {
          author_email?: string;
          body?: string;
          created_at?: string;
          id?: string;
          suggestion_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_notes_suggestion_id_fkey';
            columns: ['suggestion_id'];
            isOneToOne: false;
            referencedRelation: 'suggestions';
            referencedColumns: ['id'];
          },
        ];
      };
      admins: {
        Row: {
          added_by: string | null;
          created_at: string;
          email: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          email: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          active: boolean;
          capabilities: string[];
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['asset_kind'];
          length_ft: number | null;
          name: string;
          notes: string | null;
          status: Database['public']['Enums']['asset_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          capabilities?: string[];
          created_at?: string;
          id?: string;
          kind: Database['public']['Enums']['asset_kind'];
          length_ft?: number | null;
          name: string;
          notes?: string | null;
          status?: Database['public']['Enums']['asset_status'];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          capabilities?: string[];
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['asset_kind'];
          length_ft?: number | null;
          name?: string;
          notes?: string | null;
          status?: Database['public']['Enums']['asset_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_email: string;
          after: Json | null;
          before: Json | null;
          created_at: string;
          id: number;
          suggestion_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_email: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: never;
          suggestion_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: never;
          suggestion_id?: string | null;
        };
        Relationships: [];
      };
      certification_types: {
        Row: {
          label: string;
          position: number;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          label: string;
          position?: number;
          slug: string;
        };
        Update: {
          label?: string;
          position?: number;
          slug?: string;
        };
        Relationships: [];
      };
      checklist_templates: {
        Row: {
          id: string;
          job_type: Database['public']['Enums']['job_type'];
          label: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          job_type: Database['public']['Enums']['job_type'];
          label: string;
          position?: number;
        };
        Update: {
          id?: string;
          job_type?: Database['public']['Enums']['job_type'];
          label?: string;
          position?: number;
        };
        Relationships: [];
      };
      crew_certifications: {
        Row: {
          created_at: string;
          crew_member_id: string;
          expires_on: string | null;
          id: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          crew_member_id: string;
          expires_on?: string | null;
          id?: string;
          type: string;
        };
        Update: {
          created_at?: string;
          crew_member_id?: string;
          expires_on?: string | null;
          id?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'crew_certifications_crew_member_id_fkey';
            columns: ['crew_member_id'];
            isOneToOne: false;
            referencedRelation: 'crew_members';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'crew_certifications_type_fkey';
            columns: ['type'];
            isOneToOne: false;
            referencedRelation: 'certification_types';
            referencedColumns: ['slug'];
          },
        ];
      };
      crew_members: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string;
          email: string | null;
          id: string;
          lift_capacity_lbs: number | null;
          office_notes: string | null;
          phone: string | null;
          position: Database['public']['Enums']['crew_position'];
          sms_opt_in: boolean;
          sms_opt_in_at: string | null;
          sms_opt_in_method: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name: string;
          email?: string | null;
          id?: string;
          lift_capacity_lbs?: number | null;
          office_notes?: string | null;
          phone?: string | null;
          position?: Database['public']['Enums']['crew_position'];
          sms_opt_in?: boolean;
          sms_opt_in_at?: string | null;
          sms_opt_in_method?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string;
          email?: string | null;
          id?: string;
          lift_capacity_lbs?: number | null;
          office_notes?: string | null;
          phone?: string | null;
          position?: Database['public']['Enums']['crew_position'];
          sms_opt_in?: boolean;
          sms_opt_in_at?: string | null;
          sms_opt_in_method?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      crew_skills: {
        Row: {
          crew_member_id: string;
          skill: string;
        };
        ComputedFields: never;
        Insert: {
          crew_member_id: string;
          skill: string;
        };
        Update: {
          crew_member_id?: string;
          skill?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'crew_skills_crew_member_id_fkey';
            columns: ['crew_member_id'];
            isOneToOne: false;
            referencedRelation: 'crew_members';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'crew_skills_skill_fkey';
            columns: ['skill'];
            isOneToOne: false;
            referencedRelation: 'skills';
            referencedColumns: ['slug'];
          },
        ];
      };
      hr_notes: {
        Row: {
          author_email: string;
          body: string;
          created_at: string;
          id: string;
          report_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_email?: string;
          body: string;
          created_at?: string;
          id?: string;
          report_id: string;
        };
        Update: {
          author_email?: string;
          body?: string;
          created_at?: string;
          id?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hr_notes_report_id_fkey';
            columns: ['report_id'];
            isOneToOne: false;
            referencedRelation: 'hr_reports';
            referencedColumns: ['id'];
          },
        ];
      };
      hr_reports: {
        Row: {
          body: string;
          contact: string | null;
          created_at: string;
          deleted_at: string | null;
          full_name: string;
          id: string;
          public_reply: string | null;
          search: unknown;
          status: Database['public']['Enums']['suggestion_status'];
          tracking_hash: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          contact?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          full_name: string;
          id?: string;
          public_reply?: string | null;
          search?: never;
          status?: Database['public']['Enums']['suggestion_status'];
          tracking_hash: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          contact?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string;
          id?: string;
          public_reply?: string | null;
          search?: never;
          status?: Database['public']['Enums']['suggestion_status'];
          tracking_hash?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      hr_staff: {
        Row: {
          added_by: string | null;
          created_at: string;
          email: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          email: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      incident_photos: {
        Row: {
          created_at: string;
          id: string;
          incident_id: string;
          path: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          incident_id: string;
          path: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          incident_id?: string;
          path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'incident_photos_incident_id_fkey';
            columns: ['incident_id'];
            isOneToOne: false;
            referencedRelation: 'incident_reports';
            referencedColumns: ['id'];
          },
        ];
      };
      incident_reports: {
        Row: {
          created_at: string;
          description: string;
          fragments_retained: boolean;
          handlers_involved: string | null;
          id: string;
          job_id: string;
          job_item_id: string | null;
          occurred_at: string;
          office_followup: string | null;
          packing_kept: boolean;
          reported_by: string;
          status: Database['public']['Enums']['incident_status'];
          supervisor_name: string | null;
          supervisor_notified: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description: string;
          fragments_retained?: boolean;
          handlers_involved?: string | null;
          id?: string;
          job_id: string;
          job_item_id?: string | null;
          occurred_at: string;
          office_followup?: string | null;
          packing_kept?: boolean;
          reported_by?: string;
          status?: Database['public']['Enums']['incident_status'];
          supervisor_name?: string | null;
          supervisor_notified?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          fragments_retained?: boolean;
          handlers_involved?: string | null;
          id?: string;
          job_id?: string;
          job_item_id?: string | null;
          occurred_at?: string;
          office_followup?: string | null;
          packing_kept?: boolean;
          reported_by?: string;
          status?: Database['public']['Enums']['incident_status'];
          supervisor_name?: string | null;
          supervisor_notified?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'incident_reports_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incident_reports_job_item_id_fkey';
            columns: ['job_item_id'];
            isOneToOne: false;
            referencedRelation: 'job_items';
            referencedColumns: ['id'];
          },
        ];
      };
      job_assets: {
        Row: {
          asset_id: string;
          created_at: string;
          job_id: string;
        };
        ComputedFields: never;
        Insert: {
          asset_id: string;
          created_at?: string;
          job_id: string;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_assets_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_assets_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_assignments: {
        Row: {
          call_time_override: string | null;
          created_at: string;
          crew_member_id: string;
          job_id: string;
          role_on_job: string | null;
        };
        ComputedFields: never;
        Insert: {
          call_time_override?: string | null;
          created_at?: string;
          crew_member_id: string;
          job_id: string;
          role_on_job?: string | null;
        };
        Update: {
          call_time_override?: string | null;
          created_at?: string;
          crew_member_id?: string;
          job_id?: string;
          role_on_job?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'job_assignments_crew_member_id_fkey';
            columns: ['crew_member_id'];
            isOneToOne: false;
            referencedRelation: 'crew_members';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_assignments_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_checklist_items: {
        Row: {
          checked_at: string | null;
          checked_by: string | null;
          id: string;
          job_id: string;
          label: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          checked_at?: string | null;
          checked_by?: string | null;
          id?: string;
          job_id: string;
          label: string;
          position?: number;
        };
        Update: {
          checked_at?: string | null;
          checked_by?: string | null;
          id?: string;
          job_id?: string;
          label?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'job_checklist_items_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_items: {
        Row: {
          artist_title: string | null;
          created_at: string;
          depth_in: number | null;
          description: string;
          handling_flags: string[];
          height_in: number | null;
          id: string;
          job_id: string;
          medium: string | null;
          packing: Database['public']['Enums']['packing_kind'] | null;
          position: number;
          quantity: number;
          weight_lbs: number | null;
          width_in: number | null;
        };
        ComputedFields: never;
        Insert: {
          artist_title?: string | null;
          created_at?: string;
          depth_in?: number | null;
          description: string;
          handling_flags?: string[];
          height_in?: number | null;
          id?: string;
          job_id: string;
          medium?: string | null;
          packing?: Database['public']['Enums']['packing_kind'] | null;
          position?: number;
          quantity?: number;
          weight_lbs?: number | null;
          width_in?: number | null;
        };
        Update: {
          artist_title?: string | null;
          created_at?: string;
          depth_in?: number | null;
          description?: string;
          handling_flags?: string[];
          height_in?: number | null;
          id?: string;
          job_id?: string;
          medium?: string | null;
          packing?: Database['public']['Enums']['packing_kind'] | null;
          position?: number;
          quantity?: number;
          weight_lbs?: number | null;
          width_in?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'job_items_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_stops: {
        Row: {
          access_flags: string[];
          access_notes: string | null;
          address: string;
          contact_name: string | null;
          contact_phone: string | null;
          id: string;
          job_id: string;
          kind: Database['public']['Enums']['stop_kind'];
          position: number;
          site_name: string | null;
          window_end: string | null;
          window_start: string | null;
        };
        ComputedFields: never;
        Insert: {
          access_flags?: string[];
          access_notes?: string | null;
          address: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          id?: string;
          job_id: string;
          kind?: Database['public']['Enums']['stop_kind'];
          position?: number;
          site_name?: string | null;
          window_end?: string | null;
          window_start?: string | null;
        };
        Update: {
          access_flags?: string[];
          access_notes?: string | null;
          address?: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          id?: string;
          job_id?: string;
          kind?: Database['public']['Enums']['stop_kind'];
          position?: number;
          site_name?: string | null;
          window_end?: string | null;
          window_start?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'job_stops_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      jobs: {
        Row: {
          call_location: string | null;
          call_time: string | null;
          client_name: string | null;
          created_at: string;
          crew_notes: string | null;
          deleted_at: string | null;
          end_at: string;
          id: string;
          job_number: string;
          job_type: Database['public']['Enums']['job_type'];
          office_notes: string | null;
          start_at: string;
          status: Database['public']['Enums']['job_status'];
          team_lead_id: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          call_location?: string | null;
          call_time?: string | null;
          client_name?: string | null;
          created_at?: string;
          crew_notes?: string | null;
          deleted_at?: string | null;
          end_at: string;
          id?: string;
          job_number?: string;
          job_type: Database['public']['Enums']['job_type'];
          office_notes?: string | null;
          start_at: string;
          status?: Database['public']['Enums']['job_status'];
          team_lead_id?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          call_location?: string | null;
          call_time?: string | null;
          client_name?: string | null;
          created_at?: string;
          crew_notes?: string | null;
          deleted_at?: string | null;
          end_at?: string;
          id?: string;
          job_number?: string;
          job_type?: Database['public']['Enums']['job_type'];
          office_notes?: string | null;
          start_at?: string;
          status?: Database['public']['Enums']['job_status'];
          team_lead_id?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_team_lead_id_fkey';
            columns: ['team_lead_id'];
            isOneToOne: false;
            referencedRelation: 'crew_members';
            referencedColumns: ['id'];
          },
        ];
      };
      skills: {
        Row: {
          label: string;
          position: number;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          label: string;
          position?: number;
          slug: string;
        };
        Update: {
          label?: string;
          position?: number;
          slug?: string;
        };
        Relationships: [];
      };
      staff_roles: {
        Row: {
          added_by: string | null;
          created_at: string;
          email: string;
          role: Database['public']['Enums']['staff_role'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          email: string;
          role: Database['public']['Enums']['staff_role'];
          updated_at?: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          email?: string;
          role?: Database['public']['Enums']['staff_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
      suggestions: {
        Row: {
          admin_tag: Database['public']['Enums']['priority_tag'];
          board_summary: string | null;
          body: string;
          category: Database['public']['Enums']['suggestion_category'];
          created_at: string;
          deleted_at: string | null;
          id: string;
          photo_path: string | null;
          public_reply: string | null;
          published_to_board: boolean;
          search: unknown;
          status: Database['public']['Enums']['suggestion_status'];
          submitter_tag: Database['public']['Enums']['priority_tag'];
          tracking_hash: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_tag: Database['public']['Enums']['priority_tag'];
          board_summary?: string | null;
          body: string;
          category: Database['public']['Enums']['suggestion_category'];
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          photo_path?: string | null;
          public_reply?: string | null;
          published_to_board?: boolean;
          search?: never;
          status?: Database['public']['Enums']['suggestion_status'];
          submitter_tag: Database['public']['Enums']['priority_tag'];
          tracking_hash: string;
          updated_at?: string;
        };
        Update: {
          admin_tag?: Database['public']['Enums']['priority_tag'];
          board_summary?: string | null;
          body?: string;
          category?: Database['public']['Enums']['suggestion_category'];
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          photo_path?: string | null;
          public_reply?: string | null;
          published_to_board?: boolean;
          search?: never;
          status?: Database['public']['Enums']['suggestion_status'];
          submitter_tag?: Database['public']['Enums']['priority_tag'];
          tracking_hash?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      time_off: {
        Row: {
          created_at: string;
          crew_member_id: string;
          end_date: string;
          end_time: string | null;
          id: string;
          note: string | null;
          start_date: string;
          start_time: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          crew_member_id: string;
          end_date: string;
          end_time?: string | null;
          id?: string;
          note?: string | null;
          start_date: string;
          start_time?: string | null;
        };
        Update: {
          created_at?: string;
          crew_member_id?: string;
          end_date?: string;
          end_time?: string | null;
          id?: string;
          note?: string | null;
          start_date?: string;
          start_time?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'time_off_crew_member_id_fkey';
            columns: ['crew_member_id'];
            isOneToOne: false;
            referencedRelation: 'crew_members';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      board_conflicts: {
        Args: { p_from: string; p_to: string };
        Returns: {
          asset_id: string;
          code: string;
          crew_member_id: string;
          job_id: string;
          message: string;
        }[];
      };
      can_attach_incident_photo: { Args: { p_incident: string }; Returns: boolean };
      crew_report_incident: {
        Args: {
          p_description: string;
          p_fragments: boolean;
          p_handlers: string;
          p_item: string;
          p_job: string;
          p_occurred_at: string;
          p_packing: boolean;
          p_supervisor_name: string;
          p_supervisor_notified: boolean;
        };
        Returns: string;
      };
      crew_set_checklist: { Args: { p_checked: boolean; p_item: string }; Returns: undefined };
      hard_delete_suggestion: { Args: { p_id: string }; Returns: undefined };
      hook_before_user_created: { Args: { event: Json }; Returns: Json };
      hr_hard_delete: { Args: { p_id: string }; Returns: undefined };
      hr_log_export: { Args: { p_format: string; p_row_count: number }; Returns: undefined };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_hr: { Args: Record<PropertyKey, never>; Returns: boolean };
      job_conflicts: {
        Args: { p_job: string };
        Returns: {
          asset_id: string;
          code: string;
          crew_member_id: string;
          message: string;
        }[];
      };
      keep_alive: { Args: Record<PropertyKey, never>; Returns: number };
      log_dispatch_export: {
        Args: { p_format: string; p_include_office_notes: boolean; p_scope: Json };
        Returns: undefined;
      };
      log_export: { Args: { p_filters: Json; p_format: string; p_row_count: number }; Returns: undefined };
      my_incidents: { Args: Record<PropertyKey, never>; Returns: Json };
      my_jobs: { Args: { p_from: string; p_to: string }; Returns: Json };
      my_staff_role: { Args: Record<PropertyKey, never>; Returns: string };
      portal_board: {
        Args: { p_limit?: number };
        Returns: {
          board_summary: string;
          category: Database['public']['Enums']['suggestion_category'];
          date: string;
          status: Database['public']['Enums']['suggestion_status'];
        }[];
      };
      portal_status: {
        Args: { p_hash: string };
        Returns: {
          public_reply: string;
          status: Database['public']['Enums']['suggestion_status'];
          updated_at: string;
        }[];
      };
      record_conflict_override: { Args: { p_job: string; p_reason: string }; Returns: undefined };
    };
    Enums: {
      asset_kind: 'truck' | 'van' | 'trailer' | 'equipment';
      asset_status: 'in_service' | 'out_of_service' | 'maintenance';
      crew_position: 'driver' | 'art_handler' | 'crater' | 'installer' | 'lead' | 'other';
      incident_status: 'open' | 'under_review' | 'closed';
      job_status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
      job_type:
        | 'pickup'
        | 'delivery'
        | 'install'
        | 'deinstall'
        | 'crating'
        | 'shuttle'
        | 'storage_in'
        | 'storage_out'
        | 'site_survey';
      packing_kind: 'crated' | 'soft_pack';
      priority_tag: 'just_sayin' | 'casual' | 'important' | 'urgent' | 'crucial';
      staff_role: 'admin' | 'dispatcher' | 'viewer' | 'crew';
      stop_kind: 'origin' | 'destination' | 'stop';
      suggestion_category:
        'safety' | 'trucks_equipment' | 'scheduling_dispatch' | 'crating_shop' | 'pay_policy' | 'other';
      suggestion_status: 'new' | 'reviewing' | 'planned' | 'done' | 'declined';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      asset_kind: ['truck', 'van', 'trailer', 'equipment'],
      asset_status: ['in_service', 'out_of_service', 'maintenance'],
      crew_position: ['driver', 'art_handler', 'crater', 'installer', 'lead', 'other'],
      incident_status: ['open', 'under_review', 'closed'],
      job_status: ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'],
      job_type: [
        'pickup',
        'delivery',
        'install',
        'deinstall',
        'crating',
        'shuttle',
        'storage_in',
        'storage_out',
        'site_survey',
      ],
      packing_kind: ['crated', 'soft_pack'],
      priority_tag: ['just_sayin', 'casual', 'important', 'urgent', 'crucial'],
      staff_role: ['admin', 'dispatcher', 'viewer', 'crew'],
      stop_kind: ['origin', 'destination', 'stop'],
      suggestion_category: ['safety', 'trucks_equipment', 'scheduling_dispatch', 'crating_shop', 'pay_policy', 'other'],
      suggestion_status: ['new', 'reviewing', 'planned', 'done', 'declined'],
    },
  },
} as const;
