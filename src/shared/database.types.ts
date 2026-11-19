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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      hard_delete_suggestion: { Args: { p_id: string }; Returns: undefined };
      hook_before_user_created: { Args: { event: Json }; Returns: Json };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      keep_alive: { Args: Record<PropertyKey, never>; Returns: number };
      log_export: { Args: { p_filters: Json; p_format: string; p_row_count: number }; Returns: undefined };
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
    };
    Enums: {
      priority_tag: 'just_sayin' | 'casual' | 'important' | 'urgent' | 'crucial';
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
      priority_tag: ['just_sayin', 'casual', 'important', 'urgent', 'crucial'],
      suggestion_category: ['safety', 'trucks_equipment', 'scheduling_dispatch', 'crating_shop', 'pay_policy', 'other'],
      suggestion_status: ['new', 'reviewing', 'planned', 'done', 'declined'],
    },
  },
} as const;
