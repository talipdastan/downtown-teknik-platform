import 'package:avm_tech_platform/core/permissions/permission_models.dart';

/// İş Takip modülünün eski (AVM TECH) menü / işlem anahtarlarını merkezi 8 bağımsız
/// modül yetkisine eşler. Eski ekranlar değiştirilmeden aynı kontrolleri kullanır.
///
/// Eşleme (PERMISSIONS.md):
///   menü  overview / tickets / work_orders / notifications → work_tracking.view
///   işlem ticket_create        → work_tracking.create
///   işlem work_order_assign    → work_tracking.manage (+ create)
///   işlem work_order_execute   → work_tracking.edit
///   işlem work_order_review    → work_tracking.approve
///   işlem export_reports       → work_tracking.reports
extension WorkTrackingAccess on ProfileModel {
  static const String moduleKey = 'work_tracking';

  bool hasMenuAccess(String menuKey) {
    switch (menuKey) {
      case 'overview':
      case 'tickets':
      case 'work_orders':
      case 'notifications':
        return hasModulePermission(moduleKey, ModulePermission.view);
      case 'reports':
        return hasModulePermission(moduleKey, ModulePermission.reports);
      case 'users':
        return hasCoreAction(CoreAction.manageUsers);
      case 'departments':
      case 'locations':
      case 'categories':
        return hasCoreAction(CoreAction.manageDefinitions);
      case 'settings':
        return true;
      default:
        return false;
    }
  }

  bool hasActionAccess(String actionKey) {
    switch (actionKey) {
      case 'ticket_create':
        return hasModulePermission(moduleKey, ModulePermission.create);
      case 'work_order_assign':
        return hasModulePermission(moduleKey, ModulePermission.manage) &&
            hasModulePermission(moduleKey, ModulePermission.create);
      case 'work_order_execute':
        return hasModulePermission(moduleKey, ModulePermission.edit);
      case 'work_order_review':
        // Yönetici onay ekranı: approve + manage. (Bildirenin kendi kaydını onaylaması
        // arıza detayında yalnızca approve ile yapılır.)
        return hasModulePermission(moduleKey, ModulePermission.approve) &&
            hasModulePermission(moduleKey, ModulePermission.manage);
      case 'export_reports':
        return hasModulePermission(moduleKey, ModulePermission.reports);
      case 'manage_definitions':
        return hasCoreAction(CoreAction.manageDefinitions);
      case 'manage_users':
        return hasCoreAction(CoreAction.manageUsers);
      default:
        return false;
    }
  }
}
