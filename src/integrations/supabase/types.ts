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
      app_settings: {
        Row: {
          id: string
          updated_at: string
        }
        Insert: {
          id?: string
          updated_at?: string
        }
        Update: {
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinics: {
        Row: {
          address: string
          avg_time_per_patient: number
          clinic_mobile: string | null
          created_at: string
          id: string
          name: string
          status: string
          subscription_rate: number
          trial_ends_at: string
          updated_at: string
          whatsapp_connected: boolean
        }
        Insert: {
          address: string
          avg_time_per_patient?: number
          clinic_mobile?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          subscription_rate?: number
          trial_ends_at?: string
          updated_at?: string
          whatsapp_connected?: boolean
        }
        Update: {
          address?: string
          avg_time_per_patient?: number
          clinic_mobile?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          subscription_rate?: number
          trial_ends_at?: string
          updated_at?: string
          whatsapp_connected?: boolean
        }
        Relationships: []
      }
      doctor_shift_status: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          delay_minutes: number
          doctor_id: string
          id: string
          shift_date: string
          status: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          doctor_id: string
          id?: string
          shift_date: string
          status: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          doctor_id?: string
          id?: string
          shift_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_shift_status_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_shift_status_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          avg_time_per_patient: number | null
          clinic_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          specialty: string
          updated_at: string
        }
        Insert: {
          avg_time_per_patient?: number | null
          clinic_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          specialty: string
          updated_at?: string
        }
        Update: {
          avg_time_per_patient?: number | null
          clinic_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          specialty?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          clinic_id: string | null
          created_at: string
          id: string
          message: string
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          id?: string
          message: string
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          id?: string
          message?: string
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_notifications: {
        Row: {
          body: string
          clinic_id: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          target_date: string | null
          title: string
        }
        Insert: {
          body: string
          clinic_id: string
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          target_date?: string | null
          title: string
        }
        Update: {
          body?: string
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          target_date?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_notifications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      receptionists: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          name: string | null
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          name?: string | null
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receptionists_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          appointment_date: string
          appointment_time: string | null
          clinic_id: string
          created_at: string
          doctor_arrived_sent_at: string | null
          doctor_id: string | null
          id: string
          last_position_notified: number | null
          patient_name: string
          phone_number: string
          reminder_24h_sent_at: string | null
          status: string
          token_number: number
          token_update_count: number
          updated_at: string
          whatsapp_messages_sent: number
          whatsapp_sent_at: string | null
        }
        Insert: {
          appointment_date?: string
          appointment_time?: string | null
          clinic_id: string
          created_at?: string
          doctor_arrived_sent_at?: string | null
          doctor_id?: string | null
          id?: string
          last_position_notified?: number | null
          patient_name: string
          phone_number: string
          reminder_24h_sent_at?: string | null
          status?: string
          token_number: number
          token_update_count?: number
          updated_at?: string
          whatsapp_messages_sent?: number
          whatsapp_sent_at?: string | null
        }
        Update: {
          appointment_date?: string
          appointment_time?: string | null
          clinic_id?: string
          created_at?: string
          doctor_arrived_sent_at?: string | null
          doctor_id?: string | null
          id?: string
          last_position_notified?: number | null
          patient_name?: string
          phone_number?: string
          reminder_24h_sent_at?: string | null
          status?: string
          token_number?: number
          token_update_count?: number
          updated_at?: string
          whatsapp_messages_sent?: number
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tokens_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tokens_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_clinic_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "receptionist"
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
      app_role: ["super_admin", "receptionist"],
    },
  },
} as const
