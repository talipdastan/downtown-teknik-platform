import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_provider.dart';
import '../modules/app_module.dart';
import '../permissions/permission_models.dart';
import '../theme/app_theme.dart';
import '../update/app_update_service.dart';
import '../widgets/modern_shell_widgets.dart';

/// Platform Ana Ekranı (Tasarım B – Lacivert & Turkuaz):
/// En üstte İsim Soy İsim + Ünvan, ortada kompakt modül kartları, altta yüzen bar.
class ModuleLauncherScreen extends ConsumerStatefulWidget {
  const ModuleLauncherScreen({super.key});

  @override
  ConsumerState<ModuleLauncherScreen> createState() =>
      _ModuleLauncherScreenState();
}

class _ModuleLauncherScreenState extends ConsumerState<ModuleLauncherScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        AppUpdateService.checkAndPrompt(context);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final profile = auth.profile;
    final registry = ref.watch(moduleRegistryProvider);
    final serverModulesAsync = ref.watch(systemModulesProvider);

    if (profile == null) {
      return const AppBackScope(
        isHome: true,
        child: Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final visibleModules = registry.visibleModulesFor(
      profile,
      serverStates: serverModulesAsync.valueOrNull,
    );
    final canManageUsers =
        profile.isSystemAdmin || profile.hasCoreAction(CoreAction.manageUsers);

    return AppBackScope(
      isHome: true,
      child: Scaffold(
        appBar: const ModernUserTopBar(statusPill: 'DOWNTOWN TEKNİK'),
        body: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(systemModulesProvider);
            await ref.read(authProvider.notifier).loadProfile(profile.id);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
            children: [
              const Padding(
                padding: EdgeInsets.only(left: 4, bottom: 6),
                child: Text(
                  'MODÜLLER',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (visibleModules.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(20),
                    child: Text(
                      'Hesabınıza tanımlı aktif modül bulunmuyor. Lütfen sistem yöneticisi ile iletişime geçiniz.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  ),
                )
              else
                ...visibleModules.map((mod) => _ModuleCard(module: mod)),
              if (profile.role != 'employee') ...[
                const SizedBox(height: 8),
                const Padding(
                  padding: EdgeInsets.only(left: 4, bottom: 6),
                  child: Text(
                    'KURUMSAL CMMS & SAHA ARAÇLARI',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.7,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => context.push('/cmms?tab=0'),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      child: Row(
                        children: [
                          PastelIconBox(
                            icon: Icons.fact_check_rounded,
                            color: AppColors.accentTurquoise,
                            background: AppColors.turquoiseSoft,
                            size: 40,
                            iconSize: 21,
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Saha CMMS (Checklist · Vardiya · Stok)',
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Planlı bakım rutinleri, nöbet devri ve kritik stok takibi',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                        ],
                      ),
                    ),
                  ),
                ),
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => context.push('/equipment-passport'),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      child: Row(
                        children: [
                          PastelIconBox(
                            icon: Icons.qr_code_scanner_rounded,
                            color: AppColors.primaryNavy,
                            background: AppColors.primarySoft,
                            size: 40,
                            iconSize: 21,
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Ekipman Karnesi & QR Sorgu',
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Ekipman koduyla 360° arıza/bakım geçmişi ve hızlı arıza açma',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              if (canManageUsers) ...[
                const SizedBox(height: 8),
                const Padding(
                  padding: EdgeInsets.only(left: 4, bottom: 6),
                  child: Text(
                    'YÖNETİM',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.7,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => context.go('/admin/users'),
                    child: const Padding(
                      padding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      child: Row(
                        children: [
                          PastelIconBox(
                            icon: Icons.people_alt_rounded,
                            color: AppColors.primaryNavy,
                            background: AppColors.primarySoft,
                            size: 40,
                            iconSize: 21,
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Personel Yönetimi',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Kullanıcı onayları, roller, departman ve modül yetkileri',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            Icons.chevron_right_rounded,
                            color: AppColors.textSecondary,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        bottomNavigationBar: const FloatingPillBottomBar(activeKey: 'home'),
      ),
    );
  }
}

class _ModuleCard extends StatelessWidget {
  final AppModule module;

  const _ModuleCard({required this.module});

  Color _softBg(Color accent) {
    if (accent == AppColors.energyAccent) return AppColors.turquoiseSoft;
    if (accent == AppColors.workTrackingAccent) return AppColors.primarySoft;
    if (accent == AppColors.maintenanceAccent) return AppColors.coolingSoft;
    return AppColors.primarySoft;
  }

  @override
  Widget build(BuildContext context) {
    final disabled = module.isComingSoon;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: disabled ? null : () => context.go(module.entryRoute),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                PastelIconBox(
                  icon: module.icon,
                  color:
                      disabled ? AppColors.textSecondary : module.accentColor,
                  background: disabled
                      ? AppColors.background
                      : _softBg(module.accentColor),
                  size: 40,
                  iconSize: 21,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              module.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: disabled
                                    ? AppColors.textSecondary
                                    : AppColors.textPrimary,
                              ),
                            ),
                          ),
                          if (disabled) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: AppColors.background,
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: const Text(
                                'Yakında',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        module.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!disabled)
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppColors.textSecondary,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
