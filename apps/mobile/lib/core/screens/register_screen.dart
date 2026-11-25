import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/modern_shell_widgets.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _fullNameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      await ref.read(authProvider.notifier).signUp(
            fullName: _fullNameCtrl.text.trim(),
            email: _emailCtrl.text.trim(),
            password: _passwordCtrl.text,
            phone: _phoneCtrl.text.trim(),
          );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final isLoading = _submitting || auth.status == AuthStatus.loading;

    return AppBackScope(
      fallbackRoute: '/login',
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Personel Kaydı'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/login'),
          ),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextFormField(
                        controller: _fullNameCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Ad Soyad',
                          prefixIcon: Icon(Icons.badge_outlined),
                        ),
                        validator: (v) =>
                            (v == null || v.trim().length < 3) ? 'Ad Soyad giriniz' : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _phoneCtrl,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Telefon (Opsiyonel)',
                          prefixIcon: Icon(Icons.phone_outlined),
                        ),
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _emailCtrl,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                          labelText: 'E-posta',
                          prefixIcon: Icon(Icons.email_outlined),
                        ),
                        validator: (v) => (v == null || !v.contains('@'))
                            ? 'Geçerli bir e-posta giriniz'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _passwordCtrl,
                        obscureText: true,
                        decoration: const InputDecoration(
                          labelText: 'Parola (En az 6 karakter)',
                          prefixIcon: Icon(Icons.lock_outline),
                        ),
                        validator: (v) => (v == null || v.length < 6)
                            ? 'En az 6 karakter olmalıdır'
                            : null,
                      ),
                      if (auth.errorMessage != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          auth.errorMessage!,
                          style: const TextStyle(color: AppColors.priorityUrgent),
                        ),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: isLoading ? null : _submit,
                        child: isLoading
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Kayıt Oluştur'),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'Yeni kayıtlar güvenlik gereği yönetici onayından sonra aktif olur.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
