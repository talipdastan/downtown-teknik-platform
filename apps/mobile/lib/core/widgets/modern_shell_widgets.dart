import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:avm_tech_platform/core/auth/auth_provider.dart';
import 'package:avm_tech_platform/core/notifications/notification_providers.dart';
import 'package:avm_tech_platform/core/permissions/permission_models.dart';
import 'package:avm_tech_platform/core/theme/app_theme.dart';

/// Android geri tuşu / geri kaydırma yönetimi:
/// - `isHome == false` (üst seviye modül/yönetim ekranları): stack boşsa
///   uygulamadan çıkmak yerine `fallbackRoute` ('/home') ekranına döner.
/// - `isHome == true` (Ana Ekran / Giriş): tek basışta uygulamadan çıkmaz;
///   2 saniye içinde ikinci kez basılırsa `SystemNavigator.pop()` ile çıkar.
class AppBackScope extends StatefulWidget {
  final Widget child;
  final bool isHome;
  final String fallbackRoute;
  final DateTime Function()? clock;
  final VoidCallback? onExit;

  const AppBackScope({
    super.key,
    required this.child,
    this.isHome = false,
    this.fallbackRoute = '/home',
    this.clock,
    this.onExit,
  });

  @override
  State<AppBackScope> createState() => _AppBackScopeState();
}

class _AppBackScopeState extends State<AppBackScope> {
  DateTime? _lastBackPress;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (!widget.isHome) {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go(widget.fallbackRoute);
          }
          return;
        }
        final now = (widget.clock ?? DateTime.now)();
        final withinWindow = _lastBackPress != null &&
            now.difference(_lastBackPress!) <= const Duration(seconds: 2);
        if (withinWindow) {
          if (widget.onExit != null) {
            widget.onExit!();
          } else {
            SystemNavigator.pop();
          }
          return;
        }
        _lastBackPress = now;
        final messenger = ScaffoldMessenger.maybeOf(context);
        messenger?.hideCurrentSnackBar();
        messenger?.showSnackBar(
          const SnackBar(
            content: Text('Uygulamadan çıkmak için geri tuşuna tekrar basın'),
            duration: Duration(seconds: 2),
          ),
        );
      },
      child: widget.child,
    );
  }
}

/// İsim soyisimden 1–2 harfli monogram üretir (örn. "Talip Daştan" -> "TD").
String userInitials(String fullName) {
  final parts = fullName
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'DT';
  if (parts.length == 1) {
    return parts.first.substring(0, parts.first.length >= 2 ? 2 : 1).toUpperCase();
  }
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

/// Modern pastel dolgulu yuvarlatılmış kare ikon rozeti.
class PastelIconBox extends StatelessWidget {
  final IconData icon;
  final Color color;
  final Color background;
  final double size;
  final double iconSize;

  const PastelIconBox({
    super.key,
    required this.icon,
    required this.color,
    required this.background,
    this.size = 36,
    this.iconSize = 19,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Icon(icon, color: color, size: iconSize),
    );
  }
}

/// Tasarım B – En üstte İsim Soy İsim + Ünvan gösteren modern beyaz üst bar.
class ModernUserTopBar extends ConsumerWidget implements PreferredSizeWidget {
  final String? statusPill;
  final VoidCallback? onStatusPillTap;
  final bool showBack;

  const ModernUserTopBar({
    super.key,
    this.statusPill,
    this.onStatusPillTap,
    this.showBack = false,
  });

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(authProvider).profile;
    final unread = ref.watch(unreadCountProvider).maybeWhen(
          data: (n) => n,
          orElse: () => 0,
        );

    final displayName = (profile?.fullName ?? 'DOWNTOWN TEKNİK').toUpperCase();
    final displayTitle =
        (profile?.customRole?.trim().isNotEmpty == true
                ? profile!.customRole!
                : (profile?.roleLabel ?? 'TEKNİK OPERASYON'))
            .toUpperCase();
    final showPill = statusPill != null && MediaQuery.sizeOf(context).width >= 360;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          child: Row(
            children: [
              if (showBack) ...[
                InkWell(
                  onTap: () => context.canPop() ? context.pop() : context.go('/home'),
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: AppColors.background,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: const Icon(
                      Icons.arrow_back_ios_new_rounded,
                      size: 15,
                      color: AppColors.primaryNavy,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Tooltip(
                  message: 'Hesap ve Profil Bilgilerim',
                  child: InkWell(
                    onTap: () => context.push('/profile'),
                    borderRadius: BorderRadius.circular(10),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          Container(
                            width: 34,
                            height: 34,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [AppColors.primaryNavy, AppColors.secondaryNavy],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              userInitials(profile?.fullName ?? 'DT'),
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 12.5,
                                letterSpacing: 0.4,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        displayName,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w800,
                                          color: AppColors.textPrimary,
                                          letterSpacing: 0.2,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    const Icon(
                                      Icons.edit_outlined,
                                      size: 12,
                                      color: AppColors.textSecondary,
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  displayTitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.textSecondary,
                                    letterSpacing: 0.3,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (showPill) ...[
                const SizedBox(width: 5),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 92),
                  child: InkWell(
                    onTap: onStatusPillTap,
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.turquoiseSoft,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        statusPill!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.accentTurquoise,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(width: 5),
              _TopIconSquare(
                tooltip: 'Bildirimler',
                onTap: () => context.push('/notifications'),
                child: Badge(
                  isLabelVisible: unread > 0,
                  label: Text('$unread'),
                  child: const Icon(
                    Icons.notifications_none_rounded,
                    size: 18,
                    color: AppColors.primaryNavy,
                  ),
                ),
              ),
              const SizedBox(width: 5),
              _TopIconSquare(
                tooltip: 'Oturumu Kapat',
                onTap: () => _confirmSignOut(context, ref),
                child: const Icon(
                  Icons.logout_rounded,
                  size: 18,
                  color: AppColors.priorityUrgent,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
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
              minimumSize: const Size(90, 40),
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
}

class _TopIconSquare extends StatelessWidget {
  final Widget child;
  final String tooltip;
  final VoidCallback onTap;

  const _TopIconSquare({
    required this.child,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          alignment: Alignment.center,
          child: child,
        ),
      ),
    );
  }
}

/// Tasarım B – Yüzen hap (floating pill) alt navigasyon barı.
/// Profil sekmesi kullanıcı tercihiyle dahil edilmemiştir.
class FloatingPillBottomBar extends ConsumerWidget {
  final String activeKey; // 'home' | 'energy' | 'work_tracking' | 'users'
  final String? quickActionLabel;
  final IconData? quickActionIcon;
  final VoidCallback? onQuickAction;

  const FloatingPillBottomBar({
    super.key,
    required this.activeKey,
    this.quickActionLabel,
    this.quickActionIcon,
    this.onQuickAction,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(authProvider).profile;
    final canEnergy =
        profile?.hasModulePermission('energy', ModulePermission.enabled) ?? false;
    final canWork =
        profile?.hasModulePermission('work_tracking', ModulePermission.enabled) ??
            false;
    final canUsers = (profile?.isSystemAdmin ?? false) ||
        (profile?.hasCoreAction(CoreAction.manageUsers) ?? false);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 2, 8, 6),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryNavy.withValues(alpha: 0.10),
                blurRadius: 16,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              _NavPillItem(
                icon: Icons.grid_view_rounded,
                label: 'Modüller',
                active: activeKey == 'home',
                onTap: () => context.go('/home'),
              ),
              if (canEnergy)
                _NavPillItem(
                  icon: Icons.bolt_rounded,
                  label: 'Enerji',
                  active: activeKey == 'energy',
                  onTap: () => context.go('/energy'),
                ),
              if (canWork)
                _NavPillItem(
                  icon: Icons.build_rounded,
                  label: 'İş Takip',
                  active: activeKey == 'work_tracking',
                  onTap: () => context.go('/work-tracking'),
                ),
              if (canUsers)
                _NavPillItem(
                  icon: Icons.people_alt_rounded,
                  label: 'Personel',
                  active: activeKey == 'users',
                  onTap: () => context.go('/admin/users'),
                ),
              if (onQuickAction != null && quickActionLabel != null) ...[
                const SizedBox(width: 4),
                InkWell(
                  onTap: onQuickAction,
                  borderRadius: BorderRadius.circular(13),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.accentTurquoise,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          quickActionIcon ?? Icons.add_rounded,
                          color: Colors.white,
                          size: 16,
                        ),
                        const SizedBox(height: 1),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            quickActionLabel!,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _NavPillItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _NavPillItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 2),
          decoration: BoxDecoration(
            color: active ? AppColors.primarySoft : Colors.transparent,
            borderRadius: BorderRadius.circular(13),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: 18,
                color: active ? AppColors.primaryNavy : AppColors.textSecondary,
              ),
              const SizedBox(height: 1.5),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  label,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                    color: active ? AppColors.primaryNavy : AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
