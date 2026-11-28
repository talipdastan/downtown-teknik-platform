import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/utils/error_utils.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/core/widgets/modern_shell_widgets.dart';

final _allUsersProvider =
    FutureProvider.autoDispose<List<ProfileModel>>((ref) async {
  final data = await Api.client
      .from('profiles')
      .select('id, full_name, phone, role, custom_role, approval_status, department_id, permissions, created_at, departments(name)')
      .order('created_at', ascending: false);
  return (data as List)
      .map((e) => ProfileModel.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});

final _departmentsListProvider =
    FutureProvider.autoDispose<List<({String id, String name})>>((ref) async {
  final data = await Api.client
      .from('departments')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
  return (data as List)
      .map((e) => (
            id: (e as Map)['id'] as String,
            name: e['name'] as String,
          ))
      .toList();
});

/// Mobil Personel Yönetimi Ekranı (Onay Bekleyenler, Rol, Departman ve Modül Yetkileri).
class UsersManagementScreen extends ConsumerStatefulWidget {
  const UsersManagementScreen({super.key});

  @override
  ConsumerState<UsersManagementScreen> createState() =>
      _UsersManagementScreenState();
}

class _UsersManagementScreenState extends ConsumerState<UsersManagementScreen> {
  String _filter = 'all'; // 'all' | 'pending' | 'approved' | 'disabled'

  static const _roles = [
    ('employee', 'AVM Personeli'),
    ('technician', 'Teknik Personel'),
    ('team_lead', 'Ekip Sorumlusu'),
    ('technical_manager', 'Teknik Yönetici'),
    ('system_admin', 'Sistem Yöneticisi'),
  ];

  static String _statusLabel(String s) {
    switch (s) {
      case 'approved':
        return 'Onaylı';
      case 'pending':
        return 'Onay Bekliyor';
      case 'rejected':
        return 'Reddedildi';
      case 'disabled':
        return 'Pasif';
      default:
        return s;
    }
  }

  static Color _statusColor(String s) {
    switch (s) {
      case 'approved':
        return AppColors.statusSuccess;
      case 'pending':
        return AppColors.priorityHigh;
      case 'rejected':
      case 'disabled':
        return AppColors.priorityUrgent;
      default:
        return AppColors.textSecondary;
    }
  }

  Future<void> _openCreateUserSheet() async {
    final currentUser = ref.read(authProvider).profile;
    final isAdmin = currentUser?.isSystemAdmin ?? false;
    final allowedRoles = isAdmin
        ? _roles
        : _roles.where((r) => r.$1 != 'system_admin').toList();

    final depts = ref.read(_departmentsListProvider).valueOrNull ??
        const <({String id, String name})>[];
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final passCtrl = TextEditingController();
    final customRoleCtrl = TextEditingController();
    String selectedRole = 'technician';
    String? selectedDeptId;
    bool saving = false;

    final createdPass = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              16,
              16,
              16,
              MediaQuery.of(ctx).viewInsets.bottom + 16,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Yeni Personel Ekle',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(labelText: 'Ad Soyad *'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Telefon'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'E-Posta (Opsiyonel)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: passCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Geçici Şifre (Boşsa 123456)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: allowedRoles.any((r) => r.$1 == selectedRole)
                        ? selectedRole
                        : allowedRoles.first.$1,
                    decoration: const InputDecoration(labelText: 'Sistem Rolü'),
                    items: allowedRoles
                        .map((r) => DropdownMenuItem(
                              value: r.$1,
                              child: Text(r.$2),
                            ))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setSheet(() => selectedRole = v);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: customRoleCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Özel Ünvan (Opsiyonel)',
                      hintText: 'Örn: Operasyon Müdürü',
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String?>(
                    initialValue: selectedDeptId,
                    decoration: const InputDecoration(labelText: 'Departman'),
                    items: [
                      const DropdownMenuItem<String?>(
                        value: null,
                        child: Text('Departman Seçilmedi'),
                      ),
                      ...depts.map((d) => DropdownMenuItem<String?>(
                            value: d.id,
                            child: Text(d.name),
                          )),
                    ],
                    onChanged: (v) => setSheet(() => selectedDeptId = v),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: saving ? null : () => Navigator.pop(ctx),
                          child: const Text('Vazgeç'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: FilledButton(
                          onPressed: saving
                              ? null
                              : () async {
                                  final fullName = nameCtrl.text.trim();
                                  if (fullName.isEmpty) {
                                    showAppSnack(ctx, 'Ad Soyad zorunludur.', error: true);
                                    return;
                                  }
                                  final rawPass = passCtrl.text.trim();
                                  if (rawPass.isNotEmpty && rawPass.length < 6) {
                                    showAppSnack(
                                      ctx,
                                      'Şifre en az 6 karakter olmalıdır.',
                                      error: true,
                                    );
                                    return;
                                  }
                                  final finalPass = rawPass.isEmpty ? '123456' : rawPass;
                                  final cleanCustom = customRoleCtrl.text.trim();
                                  setSheet(() => saving = true);
                                  try {
                                    await Api.client.rpc(
                                      'rpc_admin_create_user',
                                      params: {
                                        'p_full_name': fullName,
                                        'p_phone': phoneCtrl.text.trim().isEmpty
                                            ? null
                                            : phoneCtrl.text.trim(),
                                        'p_email': emailCtrl.text.trim().isEmpty
                                            ? null
                                            : emailCtrl.text.trim(),
                                        'p_password': finalPass,
                                        'p_role': selectedRole,
                                        'p_department_id': selectedDeptId,
                                        'p_custom_role':
                                            cleanCustom.isEmpty ? null : cleanCustom,
                                      },
                                    );
                                    if (ctx.mounted) Navigator.pop(ctx, finalPass);
                                  } catch (e) {
                                    if (ctx.mounted) {
                                      showAppSnack(ctx, friendlyError(e), error: true);
                                    }
                                  } finally {
                                    if (ctx.mounted) setSheet(() => saving = false);
                                  }
                                },
                          child: Text(saving ? 'Ekleniyor...' : 'Ekle ve Onayla'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    final createdName = nameCtrl.text.trim();
    nameCtrl.dispose();
    phoneCtrl.dispose();
    emailCtrl.dispose();
    passCtrl.dispose();
    customRoleCtrl.dispose();

    if (createdPass != null) {
      ref.invalidate(_allUsersProvider);
      if (mounted) {
        showAppSnack(context, '$createdName eklendi. Şifre: $createdPass');
      }
    }
  }

  static Map<String, Map<String, bool>> _buildModuleMapFor(
    String role, [
    ProfileModel? source,
  ]) {
    final result = <String, Map<String, bool>>{};
    for (final modKey in const ['energy', 'work_tracking']) {
      final modMap = <String, bool>{};
      for (final perm in ModulePermission.values) {
        modMap[perm.key] = source != null
            ? source.hasModulePermission(modKey, perm)
            : ProfileModel.defaultModulePermission(role, modKey, perm);
      }
      result[modKey] = modMap;
    }
    return result;
  }

  Future<void> _openEditSheet(ProfileModel target) async {
    final currentUser = ref.read(authProvider).profile;
    final isAdmin = currentUser?.isSystemAdmin ?? false;
    final canManageUsers =
        isAdmin || (currentUser?.hasCoreAction(CoreAction.manageUsers) ?? false);
    if (!canManageUsers) {
      showAppSnack(context, 'Personel düzenleme yetkiniz bulunmuyor.', error: true);
      return;
    }
    if (!isAdmin && target.isSystemAdmin) {
      showAppSnack(
        context,
        'Sistem Yöneticisi kaydı yalnızca Sistem Yöneticisi tarafından düzenlenebilir.',
        error: true,
      );
      return;
    }

    final depts =
        ref.read(_departmentsListProvider).valueOrNull ?? const <({String id, String name})>[];
    final isSelf = target.id == currentUser?.id;

    final nameCtrl = TextEditingController(text: target.fullName);
    final phoneCtrl = TextEditingController(text: target.phone ?? '');
    final customRoleCtrl = TextEditingController(text: target.customRole ?? '');
    final newPassCtrl = TextEditingController();
    String selectedRole = target.role;
    String? selectedDeptId = target.departmentId;

    final modulePerms = _buildModuleMapFor(target.role, target);
    final coreActions = <String>{
      for (final a in CoreAction.values)
        if (target.hasCoreAction(a)) a.key,
    };
    bool resetToDefaults = false;
    bool saving = false;

    void toggleModPerm(String modKey, ModulePermission perm, bool val) {
      resetToDefaults = false;
      final modMap = modulePerms[modKey]!;
      if (perm == ModulePermission.enabled && !val) {
        for (final p in ModulePermission.values) {
          modMap[p.key] = false;
        }
      } else {
        modMap[perm.key] = val;
        if (perm != ModulePermission.enabled && val) {
          modMap[ModulePermission.enabled.key] = true;
        }
      }
    }

    final updated = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final allowedRoles = isAdmin
              ? _roles
              : _roles.where((r) => r.$1 != 'system_admin').toList();

          Widget buildModuleSection(String modKey, String title) {
            final modMap = modulePerms[modKey]!;
            final isModEnabled = modMap[ModulePermission.enabled.key] ?? false;
            return Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primaryNavy,
                          ),
                        ),
                      ),
                      StatusChip(
                        label: isModEnabled ? 'Aktif' : 'Kapalı',
                        color: isModEnabled
                            ? AppColors.statusSuccess
                            : AppColors.textSecondary,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    children: ModulePermission.values.map((perm) {
                      final checked = modMap[perm.key] ?? false;
                      return FilterChip(
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        labelPadding: const EdgeInsets.symmetric(horizontal: 2),
                        label: Text(
                          perm.label,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight:
                                checked ? FontWeight.w700 : FontWeight.w600,
                            color: checked
                                ? Colors.white
                                : AppColors.textPrimary,
                          ),
                        ),
                        selected: checked,
                        backgroundColor: AppColors.white,
                        selectedColor: AppColors.primaryNavy,
                        checkmarkColor: Colors.white,
                        side: BorderSide(
                          color: checked
                              ? AppColors.primaryNavy
                              : AppColors.border,
                        ),
                        onSelected: (val) =>
                            setSheet(() => toggleModPerm(modKey, perm, val)),
                        visualDensity: VisualDensity.compact,
                      );
                    }).toList(),
                  ),
                ],
              ),
            );
          }

          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(ctx).size.height * 0.9,
              ),
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  16,
                  16,
                  MediaQuery.of(ctx).viewInsets.bottom + 16,
                ),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              target.fullName,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                          StatusChip(
                            label: _statusLabel(target.approvalStatus),
                            color: _statusColor(target.approvalStatus),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: nameCtrl,
                        decoration: const InputDecoration(labelText: 'Ad Soyad *'),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: phoneCtrl,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: 'Telefon'),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        initialValue: allowedRoles.any((r) => r.$1 == selectedRole)
                            ? selectedRole
                            : allowedRoles.first.$1,
                        decoration: const InputDecoration(labelText: 'Sistem Rolü'),
                        items: allowedRoles
                            .map((r) => DropdownMenuItem(
                                  value: r.$1,
                                  child: Text(r.$2),
                                ))
                            .toList(),
                        onChanged: isSelf
                            ? null
                            : (v) {
                                if (v == null) return;
                                setSheet(() {
                                  selectedRole = v;
                                  final defaults = _buildModuleMapFor(v);
                                  modulePerms['energy'] = defaults['energy']!;
                                  modulePerms['work_tracking'] =
                                      defaults['work_tracking']!;
                                  resetToDefaults = true;
                                });
                              },
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: customRoleCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Özel Rol / Ünvan (Opsiyonel)',
                          hintText: 'Örn: Operasyon Müdürü',
                        ),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String?>(
                        initialValue: depts.any((d) => d.id == selectedDeptId)
                            ? selectedDeptId
                            : null,
                        decoration: const InputDecoration(labelText: 'Departman'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Departman Seçilmedi'),
                          ),
                          ...depts.map((d) => DropdownMenuItem<String?>(
                                value: d.id,
                                child: Text(d.name),
                              )),
                        ],
                        onChanged: (v) => setSheet(() => selectedDeptId = v),
                      ),
                      if (!isSelf && (isAdmin || target.role != 'system_admin')) ...[
                        const SizedBox(height: 14),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Expanded(
                              child: Text(
                                '8 BAĞIMSIZ MODÜL YETKİSİ',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: () {
                                setSheet(() {
                                  final defaults = _buildModuleMapFor(selectedRole);
                                  modulePerms['energy'] = defaults['energy']!;
                                  modulePerms['work_tracking'] =
                                      defaults['work_tracking']!;
                                  coreActions.clear();
                                  if (selectedRole == 'system_admin') {
                                    for (final a in CoreAction.values) {
                                      coreActions.add(a.key);
                                    }
                                  }
                                  resetToDefaults = true;
                                });
                              },
                              icon: const Icon(Icons.restart_alt_rounded, size: 15),
                              label: const Text(
                                'Rol Varsayılanı',
                                style: TextStyle(fontSize: 11.5),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        buildModuleSection('energy', 'Enerji Takip Modülü'),
                        const SizedBox(height: 8),
                        buildModuleSection('work_tracking', 'İş Takip Modülü'),
                        const SizedBox(height: 12),
                        const Text(
                          'ÇEKİRDEK YÖNETİM YETKİLERİ',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        ...CoreAction.values.map((action) {
                          final locked =
                              action == CoreAction.manageModules && !isAdmin;
                          final checked = coreActions.contains(action.key);
                          return SwitchListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              action.label,
                              style: const TextStyle(fontSize: 13),
                            ),
                            subtitle: locked
                                ? const Text(
                                    'Yalnızca Sistem Yöneticisi verebilir',
                                    style: TextStyle(fontSize: 11),
                                  )
                                : null,
                            value: checked,
                            onChanged: locked
                                ? null
                                : (val) => setSheet(() {
                                      if (val) {
                                        coreActions.add(action.key);
                                      } else {
                                        coreActions.remove(action.key);
                                      }
                                    }),
                          );
                        }),
                      ],
                      const SizedBox(height: 10),
                      const Text(
                        'ŞİFRE SIFIRLAMA (OPSİYONEL)',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: newPassCtrl,
                              decoration: const InputDecoration(
                                labelText: 'Yeni Şifre',
                                hintText: 'Boşsa değişmez',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton(
                            onPressed: () =>
                                setSheet(() => newPassCtrl.text = '123456'),
                            child: const Text('123456'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          if (target.approvalStatus == 'pending' && !isSelf) ...[
                            Expanded(
                              child: OutlinedButton(
                                onPressed: saving
                                    ? null
                                    : () async {
                                        setSheet(() => saving = true);
                                        try {
                                          await Api.client.rpc(
                                            'rpc_set_user_approval_status',
                                            params: {
                                              'p_user_id': target.id,
                                              'p_status': 'rejected',
                                            },
                                          );
                                          if (ctx.mounted) Navigator.pop(ctx, true);
                                        } catch (e) {
                                          if (ctx.mounted) {
                                            showAppSnack(ctx, friendlyError(e), error: true);
                                          }
                                        } finally {
                                          if (ctx.mounted) setSheet(() => saving = false);
                                        }
                                      },
                                child: const Text(
                                  'Reddet',
                                  style: TextStyle(color: AppColors.priorityUrgent),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                          ] else if (!isSelf) ...[
                            Expanded(
                              child: OutlinedButton(
                                onPressed: saving
                                    ? null
                                    : () async {
                                        setSheet(() => saving = true);
                                        final nextStatus =
                                            target.approvalStatus == 'disabled'
                                                ? 'approved'
                                                : 'disabled';
                                        try {
                                          await Api.client.rpc(
                                            'rpc_set_user_approval_status',
                                            params: {
                                              'p_user_id': target.id,
                                              'p_status': nextStatus,
                                            },
                                          );
                                          if (ctx.mounted) Navigator.pop(ctx, true);
                                        } catch (e) {
                                          if (ctx.mounted) {
                                            showAppSnack(ctx, friendlyError(e), error: true);
                                          }
                                        } finally {
                                          if (ctx.mounted) setSheet(() => saving = false);
                                        }
                                      },
                                child: Text(
                                  target.approvalStatus == 'disabled'
                                      ? 'Aktif Et'
                                      : 'Pasife Al',
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                          ],
                          Expanded(
                            flex: 2,
                            child: FilledButton(
                              onPressed: saving
                                  ? null
                                  : () async {
                                      final cleanName = nameCtrl.text.trim();
                                      if (cleanName.isEmpty) {
                                        showAppSnack(
                                          ctx,
                                          'Ad Soyad boş bırakılamaz.',
                                          error: true,
                                        );
                                        return;
                                      }
                                      final newPass = newPassCtrl.text.trim();
                                      if (newPass.isNotEmpty && newPass.length < 6) {
                                        showAppSnack(
                                          ctx,
                                          'Yeni şifre en az 6 karakter olmalıdır.',
                                          error: true,
                                        );
                                        return;
                                      }
                                      final cleanPhone = phoneCtrl.text.trim();
                                      final cleanCustomRole =
                                          customRoleCtrl.text.trim();
                                      setSheet(() => saving = true);
                                      try {
                                        if (target.approvalStatus == 'pending') {
                                          await Api.client.rpc(
                                            'rpc_approve_user',
                                            params: {
                                              'p_user_id': target.id,
                                              'p_role': selectedRole,
                                              'p_department_id': selectedDeptId,
                                              'p_custom_role': cleanCustomRole.isEmpty
                                                  ? null
                                                  : cleanCustomRole,
                                            },
                                          );
                                          if (cleanName != target.fullName ||
                                              cleanPhone != (target.phone ?? '') ||
                                              newPass.isNotEmpty) {
                                            await Api.client.rpc(
                                              'rpc_admin_update_user',
                                              params: {
                                                'p_user_id': target.id,
                                                'p_full_name': cleanName,
                                                'p_phone': cleanPhone.isEmpty
                                                    ? null
                                                    : cleanPhone,
                                                'p_email': null,
                                                'p_new_password':
                                                    newPass.isEmpty ? null : newPass,
                                                'p_role': selectedRole,
                                                'p_custom_role': cleanCustomRole.isEmpty
                                                    ? null
                                                    : cleanCustomRole,
                                                'p_department_id': selectedDeptId,
                                                'p_approval_status': 'approved',
                                              },
                                            );
                                          }
                                        } else {
                                          await Api.client.rpc(
                                            'rpc_admin_update_user',
                                            params: {
                                              'p_user_id': target.id,
                                              'p_full_name': cleanName,
                                              'p_phone': cleanPhone.isEmpty
                                                  ? null
                                                  : cleanPhone,
                                              'p_email': null,
                                              'p_new_password':
                                                  newPass.isEmpty ? null : newPass,
                                              'p_role': selectedRole,
                                              'p_custom_role': cleanCustomRole.isEmpty
                                                  ? null
                                                  : cleanCustomRole,
                                              'p_department_id': selectedDeptId,
                                              'p_approval_status':
                                                  target.approvalStatus,
                                            },
                                          );
                                        }

                                        if (!isSelf &&
                                            (isAdmin ||
                                                target.role != 'system_admin')) {
                                          final modulesPayload = <String, dynamic>{};
                                          if (!resetToDefaults) {
                                            for (final modKey in const [
                                              'energy',
                                              'work_tracking'
                                            ]) {
                                              final currentMap =
                                                  modulePerms[modKey]!;
                                              final differs =
                                                  ModulePermission.values.any(
                                                (p) =>
                                                    (currentMap[p.key] ?? false) !=
                                                    ProfileModel
                                                        .defaultModulePermission(
                                                      selectedRole,
                                                      modKey,
                                                      p,
                                                    ),
                                              );
                                              if (differs) {
                                                modulesPayload[modKey] =
                                                    Map<String, bool>.from(
                                                        currentMap);
                                              }
                                            }
                                          }

                                          final allowedCore = isAdmin
                                              ? coreActions.toList()
                                              : coreActions
                                                  .where((k) =>
                                                      k !=
                                                      CoreAction
                                                          .manageModules.key)
                                                  .toList();
                                          final permPayload = <String, dynamic>{
                                            if (modulesPayload.isNotEmpty)
                                              'modules': modulesPayload,
                                            if (allowedCore.isNotEmpty)
                                              'core_actions': allowedCore,
                                          };

                                          await Api.client.rpc(
                                            'rpc_update_user_permissions',
                                            params: {
                                              'p_user_id': target.id,
                                              'p_permissions': permPayload,
                                            },
                                          );
                                        }
                                        if (ctx.mounted) Navigator.pop(ctx, true);
                                      } catch (e) {
                                        if (ctx.mounted) {
                                          showAppSnack(ctx, friendlyError(e), error: true);
                                        }
                                      } finally {
                                        if (ctx.mounted) setSheet(() => saving = false);
                                      }
                                    },
                              child: Text(
                                saving
                                    ? 'Kaydediliyor...'
                                    : (target.approvalStatus == 'pending'
                                        ? 'Onayla ve Kaydet'
                                        : 'Kaydet'),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );

    nameCtrl.dispose();
    phoneCtrl.dispose();
    customRoleCtrl.dispose();
    newPassCtrl.dispose();

    if (updated == true) {
      ref.invalidate(_allUsersProvider);
      if (isSelf) {
        await ref.read(authProvider.notifier).refreshProfile();
      }
      if (mounted) {
        showAppSnack(context, '${target.fullName} güncellendi.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentUser = ref.watch(authProvider).profile;
    final canManageUsers = (currentUser?.isSystemAdmin ?? false) ||
        (currentUser?.hasCoreAction(CoreAction.manageUsers) ?? false);
    final usersAsync = ref.watch(_allUsersProvider);
    final allUsers = usersAsync.valueOrNull ?? const <ProfileModel>[];
    final pendingCount =
        allUsers.where((u) => u.approvalStatus == 'pending').length;

    final filtered = allUsers.where((u) {
      if (_filter == 'all') return true;
      return u.approvalStatus == _filter;
    }).toList();

    return AppBackScope(
      child: Scaffold(
        appBar: ModernUserTopBar(
          statusPill: pendingCount > 0 ? '$pendingCount Onay Bekliyor' : '${allUsers.length} Personel',
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _FilterChipBtn(
                      label: 'Tümü (${allUsers.length})',
                      selected: _filter == 'all',
                      onTap: () => setState(() => _filter = 'all'),
                    ),
                    const SizedBox(width: 6),
                    _FilterChipBtn(
                      label: 'Onay Bekleyen ($pendingCount)',
                      selected: _filter == 'pending',
                      onTap: () => setState(() => _filter = 'pending'),
                    ),
                    const SizedBox(width: 6),
                    _FilterChipBtn(
                      label: 'Onaylı',
                      selected: _filter == 'approved',
                      onTap: () => setState(() => _filter = 'approved'),
                    ),
                    const SizedBox(width: 6),
                    _FilterChipBtn(
                      label: 'Pasif',
                      selected: _filter == 'disabled',
                      onTap: () => setState(() => _filter = 'disabled'),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(_allUsersProvider);
                  ref.invalidate(_departmentsListProvider);
                },
                child: AsyncValueView(
                  value: usersAsync,
                  onRetry: () => ref.invalidate(_allUsersProvider),
                  data: (_) {
                    if (filtered.isEmpty) {
                      return ListView(
                        children: const [
                          SizedBox(height: 80),
                          Center(
                            child: Text(
                              'Bu filtrede personel kaydı bulunmuyor.',
                              style: TextStyle(color: AppColors.textSecondary),
                            ),
                          ),
                        ],
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.fromLTRB(10, 4, 10, 84),
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final u = filtered[i];
                        return Card(
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 4,
                            ),
                            leading: Container(
                              width: 38,
                              height: 38,
                              decoration: BoxDecoration(
                                color: AppColors.primarySoft,
                                borderRadius: BorderRadius.circular(11),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                userInitials(u.fullName),
                                style: const TextStyle(
                                  color: AppColors.primaryNavy,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                            title: Text(
                              u.fullName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                              ),
                            ),
                            subtitle: Text(
                              [
                                u.roleLabel,
                                if (u.departmentName != null) u.departmentName!,
                              ].join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                              ),
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                StatusChip(
                                  label: _statusLabel(u.approvalStatus),
                                  color: _statusColor(u.approvalStatus),
                                ),
                                const SizedBox(width: 4),
                                const Icon(
                                  Icons.chevron_right_rounded,
                                  color: AppColors.textSecondary,
                                  size: 20,
                                ),
                              ],
                            ),
                            onTap: () => _openEditSheet(u),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
          ],
        ),
        floatingActionButton: canManageUsers
            ? FloatingActionButton.extended(
                onPressed: _openCreateUserSheet,
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: const Text('Yeni Personel'),
              )
            : null,
        bottomNavigationBar: const FloatingPillBottomBar(activeKey: 'users'),
      ),
    );
  }
}

class _FilterChipBtn extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChipBtn({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryNavy : AppColors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? AppColors.primaryNavy : AppColors.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : AppColors.textPrimary,
          ),
        ),
      ),
    );
  }
}
