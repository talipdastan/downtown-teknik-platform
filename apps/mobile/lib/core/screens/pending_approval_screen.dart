import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_provider.dart';
import '../theme/app_theme.dart';

class PendingApprovalScreen extends ConsumerWidget {
  const PendingApprovalScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final profile = auth.profile;

    final isRejected = profile?.isRejected ?? false;
    final isDisabled = profile?.isDisabled ?? false;

    final title = isRejected
        ? 'Başvurunuz Reddedildi'
        : isDisabled
            ? 'Hesabınız Pasif Durumda'
            : 'Yönetici Onayı Bekleniyor';

    final message = isRejected || isDisabled
        ? 'Hesabınızla ilgili detaylar için Downtown Teknik Yönetimi ile iletişime geçiniz.'
        : 'Kaydınız veya profil güncellemeniz yönetici onayına sunuldu. Teknik Yönetici bilgilerinizi onayladıktan sonra modüllere tekrar erişebilirsiniz.';

    return Scaffold(
      appBar: AppBar(title: const Text('Downtown Teknik')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isRejected || isDisabled
                          ? Icons.block_rounded
                          : Icons.hourglass_top_rounded,
                      size: 56,
                      color: isRejected || isDisabled
                          ? AppColors.priorityUrgent
                          : AppColors.priorityHigh,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      message,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 24),
                    if (profile != null)
                      OutlinedButton.icon(
                        onPressed: () => ref
                            .read(authProvider.notifier)
                            .loadProfile(profile.id),
                        icon: const Icon(Icons.refresh),
                        label: const Text('Onay Durumunu Yenile'),
                      ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () =>
                          ref.read(authProvider.notifier).signOut(),
                      child: const Text('Çıkış Yap'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
