/// Her modül için birbirinden bağımsız 8 standart yetki anahtarı.
enum ModulePermission {
  enabled('enabled', 'Modül Görüntüleme'),
  view('view', 'Kayıt Görüntüleme'),
  create('create', 'Kayıt Ekleme'),
  edit('edit', 'Kayıt Düzenleme'),
  delete('delete', 'Kayıt Silme'),
  approve('approve', 'Onaylama'),
  reports('reports', 'Raporlama'),
  manage('manage', 'Yönetim İşlemleri');

  final String key;
  final String label;
  const ModulePermission(this.key, this.label);
}

/// Çekirdek platform yönetim aksiyonları.
enum CoreAction {
  manageUsers('manage_users', 'Personel & Yetki Yönetimi'),
  manageDefinitions('manage_definitions', 'Departman, Kat & Mahal Yönetimi'),
  manageEquipments('manage_equipments', 'Ortak Ekipman Yönetimi'),
  manageModules('manage_modules', 'Modül Yönetimi');

  final String key;
  final String label;
  const CoreAction(this.key, this.label);
}

class ProfileModel {
  final String id;
  final String fullName;
  final String? phone;
  final String role;
  final String? customRole;
  final String approvalStatus;
  final String? departmentId;
  final String? departmentName;
  final Map<String, dynamic> permissions;
  final DateTime createdAt;

  const ProfileModel({
    required this.id,
    required this.fullName,
    this.phone,
    required this.role,
    this.customRole,
    required this.approvalStatus,
    this.departmentId,
    this.departmentName,
    this.permissions = const {},
    required this.createdAt,
  });

  bool get isApproved => approvalStatus == 'approved';
  bool get isPending => approvalStatus == 'pending';
  bool get isRejected => approvalStatus == 'rejected';
  bool get isDisabled => approvalStatus == 'disabled';
  bool get isSystemAdmin => role == 'system_admin';
  bool get isTeamLead => role == 'team_lead';
  bool get isTechnician => role == 'technician';
  bool get isManagement =>
      role == 'team_lead' ||
      role == 'technical_manager' ||
      role == 'system_admin';

  String get roleLabel {
    if (customRole != null && customRole!.trim().isNotEmpty) {
      return customRole!.trim();
    }
    switch (role) {
      case 'system_admin':
        return 'Sistem Yöneticisi';
      case 'technical_manager':
        return 'Teknik Yönetici';
      case 'team_lead':
        return 'Ekip Sorumlusu';
      case 'technician':
        return 'Teknik Personel';
      default:
        return 'AVM Personeli';
    }
  }

  /// Supabase'deki `default_module_permission` SQL fonksiyonu ile birebir uyumlu.
  static bool defaultModulePermission(
    String role,
    String moduleKey,
    ModulePermission perm,
  ) {
    if (role == 'system_admin') return true;

    if (moduleKey == 'work_tracking') {
      switch (role) {
        case 'technical_manager':
        case 'team_lead':
          return perm != ModulePermission.delete;
        case 'technician':
          return perm == ModulePermission.enabled ||
              perm == ModulePermission.view ||
              perm == ModulePermission.create ||
              perm == ModulePermission.edit;
        case 'employee':
          return perm == ModulePermission.enabled ||
              perm == ModulePermission.view ||
              perm == ModulePermission.create ||
              perm == ModulePermission.approve;
        default:
          return false;
      }
    }

    if (moduleKey == 'energy') {
      switch (role) {
        case 'technical_manager':
          return true;
        case 'team_lead':
          return perm == ModulePermission.enabled ||
              perm == ModulePermission.view ||
              perm == ModulePermission.create ||
              perm == ModulePermission.edit ||
              perm == ModulePermission.reports;
        case 'technician':
          return perm == ModulePermission.enabled ||
              perm == ModulePermission.view ||
              perm == ModulePermission.create;
        default:
          return false;
      }
    }

    if (role == 'technical_manager') {
      return perm == ModulePermission.enabled ||
          perm == ModulePermission.view ||
          perm == ModulePermission.reports;
    }
    return false;
  }

  /// Merkezi modül yetki kontrolü (8 bağımsız izin).
  bool hasModulePermission(String moduleKey, ModulePermission perm) {
    if (!isApproved) return false;
    if (isSystemAdmin) return true;

    final modulesMap = permissions['modules'];
    if (modulesMap is Map && modulesMap[moduleKey] is Map) {
      final modPerms = modulesMap[moduleKey] as Map;
      if (modPerms['enabled'] == false) return false;
      final explicit = modPerms[perm.key];
      if (explicit is bool) return explicit;
    }

    return defaultModulePermission(role, moduleKey, perm);
  }

  /// Çekirdek yönetim aksiyon kontrolü.
  bool hasCoreAction(CoreAction action) {
    if (!isApproved) return false;
    if (isSystemAdmin) return true;

    final coreActions = permissions['core_actions'];
    if (coreActions is List) {
      return coreActions.map((e) => e.toString()).contains(action.key);
    }
    return false;
  }

  factory ProfileModel.fromJson(Map<String, dynamic> json) {
    final rawPerms = json['permissions'];
    return ProfileModel(
      id: json['id'] as String,
      fullName: json['full_name'] as String? ?? 'İsimsiz Kullanıcı',
      phone: json['phone'] as String?,
      role: json['role'] as String? ?? 'employee',
      customRole: json['custom_role'] as String?,
      approvalStatus: json['approval_status'] as String? ?? 'pending',
      departmentId: json['department_id'] as String?,
      departmentName: json['departments'] is Map
          ? (json['departments'] as Map)['name'] as String?
          : null,
      permissions:
          rawPerms is Map ? Map<String, dynamic>.from(rawPerms) : const {},
      createdAt:
          DateTime.tryParse(json['created_at'] as String? ?? '') ??
              DateTime.now(),
    );
  }
}
