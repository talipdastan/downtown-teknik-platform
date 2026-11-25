import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../auth/auth_provider.dart';
import '../config/supabase_config.dart';
import '../network/api_client.dart';
import '../permissions/permission_models.dart';
import '../theme/app_theme.dart';
import '../utils/error_utils.dart';
import '../widgets/common_widgets.dart';
import '../widgets/modern_shell_widgets.dart';

/// Kullanıcının kendi profil + hesap (e-posta, telefon, ünvan, departman) modeli.
class OwnAccountInfo {
  final String id;
  final String fullName;
  final String? phone;
  final String email;
  final String role;
  final String? customRole;
  final String? departmentName;
  final String approvalStatus;
  final DateTime createdAt;

  const OwnAccountInfo({
    required this.id,
    required this.fullName,
    this.phone,
    required this.email,
    required this.role,
    this.customRole,
    this.departmentName,
    required this.approvalStatus,
    required this.createdAt,
  });

  String get displayRoleLabel {
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

  factory OwnAccountInfo.fromProfile(ProfileModel p, {String email = ''}) {
    return OwnAccountInfo(
      id: p.id,
      fullName: p.fullName,
      phone: p.phone,
      email: email,
      role: p.role,
      customRole: p.customRole,
      departmentName: p.departmentName,
      approvalStatus: p.approvalStatus,
      createdAt: p.createdAt,
    );
  }

  factory OwnAccountInfo.fromJson(Map<String, dynamic> json) {
    return OwnAccountInfo(
      id: json['id'] as String,
      fullName: json['full_name'] as String? ?? 'İsimsiz Kullanıcı',
      phone: json['phone']?.toString(),
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString() ?? 'employee',
      customRole: json['custom_role']?.toString(),
      departmentName: json['department_name']?.toString(),
      approvalStatus: json['approval_status']?.toString() ?? 'approved',
      createdAt:
          DateTime.tryParse(json['created_at']?.toString() ?? '') ??
              DateTime.now(),
    );
  }
}

/// Saf form doğrulama yardımcısı (birim testlerle doğrudan doğrulanır).
class ProfileFormValidator {
  static String? validateName(String value) {
    final clean = value.trim();
    if (clean.isEmpty) return 'Ad Soyad alanı boş bırakılamaz.';
    if (clean.length < 3) return 'Ad Soyad en az 3 karakter olmalıdır.';
    return null;
  }

  static bool hasPersonalInfoChanged({
    required OwnAccountInfo original,
    required String newName,
    required String newPhone,
    required String newEmail,
  }) {
    final cName = newName.trim();
    final cPhone = newPhone.trim();
    final cEmail = newEmail.trim().toLowerCase();
    final oName = original.fullName.trim();
    final oPhone = (original.phone ?? '').trim();
    final oEmail = original.email.trim().toLowerCase();

    return cName != oName ||
        cPhone != oPhone ||
        (cEmail.isNotEmpty && cEmail != oEmail);
  }

  static String? validateEmail(String value) {
    final clean = value.trim();
    if (clean.isEmpty) return null;
    final at = clean.indexOf('@');
    if (at <= 0 || !clean.substring(at + 1).contains('.')) {
      return 'Geçerli bir e-posta adresi giriniz.';
    }
    return null;
  }

  static String? validatePasswordChange({
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) {
    if (currentPassword.isEmpty) {
      return 'Mevcut şifrenizi giriniz.';
    }
    if (newPassword.length < 6) {
      return 'Yeni şifre en az 6 karakter olmalıdır.';
    }
    if (newPassword != confirmPassword) {
      return 'Yeni şifreler eşleşmiyor.';
    }
    return null;
  }
}

final ownAccountProvider = FutureProvider.autoDispose<OwnAccountInfo?>((ref) async {
  final profile = ref.watch(authProvider).profile;
  final client = SupabaseConfig.clientOrNull;
  if (client == null) {
    return profile != null ? OwnAccountInfo.fromProfile(profile) : null;
  }
  try {
    final res = await Api.client.rpc('rpc_get_own_account');
    if (res is List && res.isNotEmpty) {
      return OwnAccountInfo.fromJson(Map<String, dynamic>.from(res.first as Map));
    }
  } catch (_) {
    // RPC henüz yoksa veya geçici hata varsa auth/profil yedeğini kullan
  }
  if (profile == null) return null;
  return OwnAccountInfo.fromProfile(
    profile,
    email: client.auth.currentUser?.email ?? '',
  );
});

/// Mobil kullanıcı profili, iletişim bilgileri ve şifre yenileme ekranı.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();

  final _currentPassCtrl = TextEditingController();
  final _newPassCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();

  bool _hydrated = false;
  bool _savingProfile = false;
  bool _savingPassword = false;
  bool _obscureCurrent = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _currentPassCtrl.dispose();
    _newPassCtrl.dispose();
    _confirmPassCtrl.dispose();
    super.dispose();
  }

  void _syncControllers(OwnAccountInfo account) {
    if (_hydrated) return;
    _nameCtrl.text = account.fullName;
    _phoneCtrl.text = account.phone ?? '';
    _emailCtrl.text = account.email;
    _hydrated = true;
  }

  Future<void> _saveProfileInfo(OwnAccountInfo account) async {
    final nameErr = ProfileFormValidator.validateName(_nameCtrl.text);
    if (nameErr != null) {
      showAppSnack(context, nameErr, error: true);
      return;
    }
    final emailErr = ProfileFormValidator.validateEmail(_emailCtrl.text);
    if (emailErr != null) {
      showAppSnack(context, emailErr, error: true);
      return;
    }

    final changed = ProfileFormValidator.hasPersonalInfoChanged(
      original: account,
      newName: _nameCtrl.text,
      newPhone: _phoneCtrl.text,
      newEmail: _emailCtrl.text,
    );
    if (!changed) {
      showAppSnack(context, 'Bilgilerinizde herhangi bir değişiklik yapılmadı.');
      return;
    }

    final requiresApproval = account.role != 'system_admin';
    if (requiresApproval) {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Yönetici Onayı Gerekiyor'),
          content: const Text(
            'Ad Soyad, Telefon veya E-posta bilgilerinizi değiştirdiğinizde güvenlik gereği hesabınız tekrar yönetici onayına sunulur.\n\n'
            'Yönetici onaylayana kadar modüllere erişiminiz duraklatılacaktır. Devam etmek istiyor musunuz?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Onaya Gönder'),
            ),
          ],
        ),
      );
      if (confirm != true) return;
    }

    setState(() => _savingProfile = true);
    try {
      final cleanEmail = _emailCtrl.text.trim().toLowerCase();
      await Api.client.rpc(
        'rpc_update_own_account',
        params: {
          'p_full_name': _nameCtrl.text.trim(),
          'p_phone': _phoneCtrl.text.trim().isEmpty
              ? null
              : _phoneCtrl.text.trim(),
          'p_email': cleanEmail.isEmpty ? null : cleanEmail,
        },
      );
      try {
        await SupabaseConfig.clientOrNull?.auth.refreshSession();
      } catch (_) {}
      await ref.read(authProvider.notifier).refreshProfile();
      _hydrated = false;
      ref.invalidate(ownAccountProvider);
      if (mounted) {
        showAppSnack(
          context,
          requiresApproval
              ? 'Bilgileriniz güncellendi ve yönetici onayına gönderildi.'
              : 'Kişisel bilgileriniz güncellendi.',
        );
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _changePassword(OwnAccountInfo account) async {
    final err = ProfileFormValidator.validatePasswordChange(
      currentPassword: _currentPassCtrl.text,
      newPassword: _newPassCtrl.text,
      confirmPassword: _confirmPassCtrl.text,
    );
    if (err != null) {
      showAppSnack(context, err, error: true);
      return;
    }

    setState(() => _savingPassword = true);
    try {
      await Api.client.rpc(
        'rpc_update_own_account',
        params: {
          'p_full_name': account.fullName,
          'p_phone': (account.phone == null || account.phone!.trim().isEmpty)
              ? null
              : account.phone!.trim(),
          'p_email': account.email.trim().isEmpty
              ? null
              : account.email.trim().toLowerCase(),
          'p_current_password': _currentPassCtrl.text,
          'p_new_password': _newPassCtrl.text,
        },
      );
      _currentPassCtrl.clear();
      _newPassCtrl.clear();
      _confirmPassCtrl.clear();
      if (mounted) {
        showAppSnack(context, 'Şifreniz başarıyla yenilendi.');
      }
    } catch (e) {
      if (mounted) showAppSnack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _savingPassword = false);
    }
  }

  Future<void> _confirmSignOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Oturumu Kapat'),
        content: const Text('Uygulamadan çıkış yapmak istiyor musunuz?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.priorityUrgent,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Çıkış Yap'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(authProvider.notifier).signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final accountAsync = ref.watch(ownAccountProvider);
    final profile = ref.watch(authProvider).profile;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profil & Hesap Bilgilerim'),
      ),
      body: SafeArea(
        top: false,
        child: AsyncValueView<OwnAccountInfo?>(
          value: accountAsync,
          onRetry: () {
            _hydrated = false;
            ref.invalidate(ownAccountProvider);
          },
          data: (fetched) {
            final account = fetched ??
                (profile != null ? OwnAccountInfo.fromProfile(profile) : null);
            if (account == null) {
              return const Center(child: CircularProgressIndicator());
            }
            _syncControllers(account);

            return RefreshIndicator(
              onRefresh: () async {
                _hydrated = false;
                await ref.read(authProvider.notifier).refreshProfile();
                ref.invalidate(ownAccountProvider);
              },
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                children: [
                  // 1) Hesap Özeti Kartı
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Container(
                            width: 48,
                            height: 48,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [
                                  AppColors.primaryNavy,
                                  AppColors.secondaryNavy,
                                ],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              userInitials(account.fullName),
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  account.fullName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    account.displayRoleLabel,
                                    if (account.departmentName != null)
                                      account.departmentName!,
                                  ].join(' · '),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                                if (account.email.isNotEmpty) ...[
                                  const SizedBox(height: 2),
                                  Text(
                                    account.email,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.accentTurquoise,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(width: 6),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              const StatusChip(
                                label: 'Aktif',
                                color: AppColors.statusSuccess,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                DateFormat('dd.MM.yyyy', 'tr_TR')
                                    .format(account.createdAt.toLocal()),
                                style: const TextStyle(
                                  fontSize: 10,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // 2) Kişisel Bilgiler & İletişim Formu
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Row(
                            children: [
                              Icon(
                                Icons.badge_outlined,
                                size: 18,
                                color: AppColors.primaryNavy,
                              ),
                              SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Kişisel Bilgiler & İletişim',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.primaryNavy,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _nameCtrl,
                            decoration: const InputDecoration(
                              labelText: 'Ad Soyad *',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _phoneCtrl,
                            keyboardType: TextInputType.phone,
                            decoration: const InputDecoration(
                              labelText: 'Telefon Numarası',
                              hintText: '05XX XXX XX XX',
                              prefixIcon: Icon(Icons.phone_outlined),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(
                              labelText: 'E-Posta Adresi',
                              prefixIcon: Icon(Icons.email_outlined),
                            ),
                          ),
                          if (account.role != 'system_admin') ...[
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: AppColors.electricSoft,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: AppColors.priorityHigh.withValues(alpha: 0.35),
                                ),
                              ),
                              child: const Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    Icons.info_outline_rounded,
                                    size: 16,
                                    color: AppColors.priorityHigh,
                                  ),
                                  SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Ad Soyad, Telefon veya E-posta bilgilerinde değişiklik yapıldığında hesabınız güvenlik gereği tekrar yönetici onayına sunulur.',
                                      style: TextStyle(
                                        fontSize: 11.5,
                                        color: AppColors.textPrimary,
                                        height: 1.3,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 12),
                          ],
                          FilledButton.icon(
                            onPressed: _savingProfile
                                ? null
                                : () => _saveProfileInfo(account),
                            icon: const Icon(Icons.save_outlined, size: 18),
                            label: Text(
                              _savingProfile
                                  ? 'Güncelleniyor...'
                                  : 'Bilgileri Güncelle',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // 3) Şifre Yenileme Bölümü
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Row(
                            children: [
                              Icon(
                                Icons.lock_reset_rounded,
                                size: 18,
                                color: AppColors.accentTurquoise,
                              ),
                              SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Şifre Yenile',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.accentTurquoise,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _currentPassCtrl,
                            obscureText: _obscureCurrent,
                            decoration: InputDecoration(
                              labelText: 'Mevcut Şifre',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscureCurrent
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                ),
                                onPressed: () => setState(
                                    () => _obscureCurrent = !_obscureCurrent),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _newPassCtrl,
                            obscureText: _obscureNew,
                            decoration: InputDecoration(
                              labelText: 'Yeni Şifre (En az 6 karakter)',
                              prefixIcon: const Icon(Icons.vpn_key_outlined),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscureNew
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                ),
                                onPressed: () =>
                                    setState(() => _obscureNew = !_obscureNew),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _confirmPassCtrl,
                            obscureText: _obscureConfirm,
                            decoration: InputDecoration(
                              labelText: 'Yeni Şifre (Tekrar)',
                              prefixIcon: const Icon(Icons.check_circle_outline),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscureConfirm
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                ),
                                onPressed: () => setState(
                                    () => _obscureConfirm = !_obscureConfirm),
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          FilledButton.icon(
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.accentTurquoise,
                            ),
                            onPressed: _savingPassword
                                ? null
                                : () => _changePassword(account),
                            icon: const Icon(Icons.password_rounded, size: 18),
                            label: Text(
                              _savingPassword
                                  ? 'Yenileniyor...'
                                  : 'Şifreyi Yenile',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // 4) Oturumu Kapat
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.priorityUrgent,
                    ),
                    onPressed: _confirmSignOut,
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text('Oturumu Kapat'),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
