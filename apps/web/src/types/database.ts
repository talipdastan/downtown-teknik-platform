export type UserRole =
  | 'employee'
  | 'technician'
  | 'team_lead'
  | 'technical_manager'
  | 'system_admin';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export type ModulePermissionKey =
  | 'enabled'
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'reports'
  | 'manage';

export type CoreActionKey =
  | 'manage_users'
  | 'manage_definitions'
  | 'manage_equipments'
  | 'manage_modules';

export interface ModulePermissionSet {
  enabled?: boolean;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  approve?: boolean;
  reports?: boolean;
  manage?: boolean;
  actions?: string[];
}

export interface UserPermissionsJson {
  modules?: Record<string, ModulePermissionSet>;
  core_actions?: CoreActionKey[];
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  custom_role: string | null;
  approval_status: ApprovalStatus;
  department_id: string | null;
  permissions: UserPermissionsJson;
  created_at: string;
}

export interface SystemModule {
  key: string;
  name: string;
  description: string;
  icon: string;
  route_prefix: string;
  is_enabled: boolean;
  is_coming_soon: boolean;
  sort_order: number;
}

export interface Equipment {
  id: string;
  code: string;
  name: string;
  equipment_type: string;
  department_id: string | null;
  location_id: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  warranty_end_date: string | null;
  status: 'active' | 'maintenance' | 'out_of_service' | 'retired';
  is_active: boolean;
}

export type TicketPriority = 'normal' | 'priority' | 'urgent';

export type TicketStatus =
  | 'new'
  | 'under_review'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type WorkOrderStatus =
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'cancelled';

export interface Department {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Floor {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Location {
  id: string;
  floor_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  department_id: string | null;
  icon: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string | null;
  reporter_id: string;
  location_id: string | null;
  custom_location: string | null;
  category_id: string | null;
  custom_category: string | null;
  equipment_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  description: string;
  cancellation_reason: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  ticket_id: string;
  department_id: string;
  equipment_id: string | null;
  status: WorkOrderStatus;
  created_by: string;
  work_description: string | null;
  waiting_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MeterType = 'electric' | 'mechanical';
export type MeterCategory = 'electric' | 'water' | 'cooling' | 'gas' | 'other';
export type UtilityType = 'electric' | 'gas' | 'water';

export interface Meter {
  id: string;
  legacy_id: string | null;
  name: string;
  meter_type: MeterType;
  category: MeterCategory;
  multiplier: number;
  sort_order: number;
  meter_no: string | null;
  contract_no: string | null;
  eic_code: string | null;
  tekil_code: string | null;
  subscriber_no: string | null;
  region: string | null;
  equipment_id: string | null;
  location_id: string | null;
  is_active: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export interface TrashedMeter {
  id: string;
  name: string;
  meter_type: MeterType;
  category: MeterCategory;
  multiplier: number;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string;
  readings_count: number;
  purge_at: string;
}

export interface MeterReading {
  id: string;
  meter_id: string;
  reading_date: string;
  active_value: number | null;
  inductive_value: number | null;
  capacitive_value: number | null;
  inductive_percent: number | null;
  capacitive_percent: number | null;
  index_value: number | null;
  consumption: number;
  entered_by_name: string;
  notes: string | null;
}

export interface EnergyInvoice {
  id: string;
  period_year: number;
  period_month: number;
  utility_type: UtilityType;
  provider: string;
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_type: 'normal' | 'late_fee';
  meter_id: string | null;
  meter_name: string;
  meter_no: string | null;
  contract_no: string | null;
  eic_code: string | null;
  tekil_code: string | null;
  subscriber_no: string | null;
  consumption: number;
  amount_tl: number;
  inductive_penalty_tl: number;
  capacitive_penalty_tl: number;
  tenant_consumption: number | null;
  tenant_amount_tl: number | null;
  entered_by_name: string;
  created_at: string;
}

export interface EnergyBudget {
  id: string;
  period_year: number;
  period_month: number;
  utility_type: UtilityType;
  budget_consumption: number;
  budget_tl: number;
  prev_year_consumption: number;
  prev_year_tl: number;
}
