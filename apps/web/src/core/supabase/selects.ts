/**
 * Merkezi sütun bazlı Supabase sorgu projeksiyonları (`select('*')` yerine).
 * Ağ trafiğini azaltır ve şema değişikliklerinde öngörülebilirlik sağlar.
 */

export const PROFILE_SELECT =
  'id, full_name, phone, role, custom_role, approval_status, department_id, permissions, created_at';

export const SYSTEM_MODULE_SELECT =
  'key, name, description, icon, route_prefix, is_enabled, is_coming_soon, sort_order';

export const NOTIFICATION_SELECT =
  'id, user_id, module_key, entity_type, entity_id, title, message, is_read, created_at';

export const DEPARTMENT_SELECT =
  'id, name, description, is_active, created_at';

export const FLOOR_SELECT =
  'id, name, sort_order, is_active, created_at';

export const LOCATION_SELECT =
  'id, floor_id, name, description, is_active, created_at';

export const CATEGORY_SELECT =
  'id, name, department_id, icon, is_active, created_at';

export const CUSTOM_ROLE_SELECT =
  'id, name, base_role, created_at';

export const EQUIPMENT_SELECT =
  'id, code, name, equipment_type, department_id, location_id, brand, model, serial_number, warranty_end_date, status, is_active';

export const METER_SELECT =
  'id, legacy_id, name, meter_type, category, multiplier, sort_order, meter_no, contract_no, eic_code, tekil_code, subscriber_no, region, equipment_id, location_id, is_active, deleted_at, deleted_by';

export const ENERGY_INVOICE_SELECT =
  'id, period_year, period_month, utility_type, provider, invoice_no, invoice_date, invoice_type, meter_id, meter_name, meter_no, contract_no, eic_code, tekil_code, subscriber_no, consumption, amount_tl, inductive_penalty_tl, capacitive_penalty_tl, tenant_consumption, tenant_amount_tl, entered_by_name, created_at';

export const ENERGY_BUDGET_SELECT =
  'id, period_year, period_month, utility_type, budget_consumption, budget_tl, prev_year_consumption, prev_year_tl';
