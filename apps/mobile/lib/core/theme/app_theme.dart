import 'package:flutter/material.dart';

/// Tasarım B – AVM TECH Kurumsal Lacivert & Modern Turkuaz Renk Paleti.
class AppColors {
  static const Color primaryNavy = Color(0xFF17365D);
  static const Color secondaryNavy = Color(0xFF254B75);
  static const Color accentTurquoise = Color(0xFF0E7490);
  static const Color white = Color(0xFFFFFFFF);
  static const Color background = Color(0xFFF3F6FA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color border = Color(0xFFE2E8F0);

  // Pastel ikon kutusu dolgu renkleri (modern kart dili)
  static const Color primarySoft = Color(0xFFE6EEF8);
  static const Color turquoiseSoft = Color(0xFFCFFAFE);
  static const Color electricSoft = Color(0xFFFEF3C7);
  static const Color waterSoft = Color(0xFFE0F2FE);
  static const Color coolingSoft = Color(0xFFDBEAFE);
  static const Color gasSoft = Color(0xFFFEE2E2);
  static const Color successSoft = Color(0xFFDCFCE7);

  static const Color priorityNormal = Color(0xFF64748B);
  static const Color priorityHigh = Color(0xFFD97706);
  static const Color priorityUrgent = Color(0xFFDC2626);
  static const Color statusSuccess = Color(0xFF15803D);
  static const Color statusResolved = Color(0xFF15803D);

  // Arıza / iş emri durum renkleri
  static const Color statusNew = Color(0xFF0284C7);
  static const Color statusUnderReview = Color(0xFF7C3AED);
  static const Color statusAssigned = Color(0xFF4F46E5);
  static const Color statusInProgress = Color(0xFFD97706);
  static const Color statusWaiting = Color(0xFFEA580C);
  static const Color statusClosed = Color(0xFF334155);
  static const Color statusCancelled = Color(0xFF94A3B8);

  // Modül vurgu renkleri
  static const Color energyAccent = Color(0xFF0E7490);
  static const Color workTrackingAccent = Color(0xFF17365D);
  static const Color maintenanceAccent = Color(0xFF0F766E);
  static const Color assetsAccent = Color(0xFF6D28D9);
}

class AppTheme {
  static ThemeData get lightTheme {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primaryNavy,
      brightness: Brightness.light,
      primary: AppColors.primaryNavy,
      onPrimary: Colors.white,
      secondary: AppColors.accentTurquoise,
      onSecondary: Colors.white,
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      error: AppColors.priorityUrgent,
      onError: Colors.white,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: colorScheme,
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      scaffoldBackgroundColor: AppColors.background,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.primaryNavy,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        toolbarHeight: 50,
        titleTextStyle: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 16,
          fontWeight: FontWeight.w800,
        ),
        iconTheme: IconThemeData(color: AppColors.primaryNavy, size: 21),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.white,
        selectedColor: AppColors.primaryNavy,
        disabledColor: AppColors.background,
        checkmarkColor: Colors.white,
        side: WidgetStateBorderSide.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const BorderSide(color: AppColors.primaryNavy);
          }
          return const BorderSide(color: AppColors.border);
        }),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        labelStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: WidgetStateColor.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return AppColors.textSecondary;
            }
            if (states.contains(WidgetState.selected)) {
              return Colors.white;
            }
            return AppColors.textPrimary;
          }),
        ),
        secondaryLabelStyle: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
        iconTheme: const IconThemeData(color: AppColors.primaryNavy, size: 16),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primaryNavy, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryNavy,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.border,
          disabledForegroundColor: AppColors.textSecondary,
          minimumSize: const Size(64, 40),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primaryNavy,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.border,
          disabledForegroundColor: AppColors.textSecondary,
          minimumSize: const Size(64, 40),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: AppColors.white,
          foregroundColor: AppColors.primaryNavy,
          disabledForegroundColor: AppColors.textSecondary,
          side: const BorderSide(color: AppColors.border),
          minimumSize: const Size(64, 40),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primaryNavy,
          disabledForegroundColor: AppColors.textSecondary,
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.primaryNavy,
        foregroundColor: Colors.white,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return AppColors.primaryNavy;
            }
            return AppColors.white;
          }),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return Colors.white;
            }
            return AppColors.textPrimary;
          }),
          side: WidgetStateProperty.all(
            const BorderSide(color: AppColors.border),
          ),
        ),
      ),
    );
  }
}
