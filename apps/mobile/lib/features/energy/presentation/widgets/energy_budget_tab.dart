import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:avm_tech_platform/core/theme/app_theme.dart';
import 'package:avm_tech_platform/core/widgets/common_widgets.dart';
import 'package:avm_tech_platform/features/energy/data/models/budget_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/invoice_model.dart';
import 'package:avm_tech_platform/features/energy/data/models/meter_model.dart';
import 'package:avm_tech_platform/features/energy/presentation/widgets/energy_report_wizard_sheet.dart';
import 'package:avm_tech_platform/features/energy/services/budget_parser_service.dart';
import 'package:avm_tech_platform/features/energy/services/energy_excel_service.dart';

class EnergyBudgetTab extends StatelessWidget {
  final int selectedYear;
  final int budgetMonth;
  final String budgetUtilityFilter;
  final List<String> months;
  final List<EnergyInvoiceModel> invoices;
  final List<EnergyBudgetModel> budgets;
  final List<MeterModel> meters;
  final bool canManage;
  final bool importingBudget;
  final NumberFormat numFmt;
  final NumberFormat tlFmt;
  final ValueChanged<int> onYearChanged;
  final ValueChanged<int> onMonthChanged;
  final ValueChanged<String> onUtilityFilterChanged;
  final VoidCallback onImportBudgetFile;
  final ValueChanged<EnergyBudgetModel?> onOpenBudgetForm;
  final ValueChanged<EnergyBudgetModel> onDeleteBudget;

  const EnergyBudgetTab({
    super.key,
    required this.selectedYear,
    required this.budgetMonth,
    required this.budgetUtilityFilter,
    required this.months,
    required this.invoices,
    required this.budgets,
    required this.meters,
    required this.canManage,
    required this.importingBudget,
    required this.numFmt,
    required this.tlFmt,
    required this.onYearChanged,
    required this.onMonthChanged,
    required this.onUtilityFilterChanged,
    required this.onImportBudgetFile,
    required this.onOpenBudgetForm,
    required this.onDeleteBudget,
  });

  static String _utilityLabel(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return 'Elektrik';
      case 'gas':
        return 'Doğalgaz';
      case 'water':
        return 'Su';
      default:
        return type;
    }
  }

  static IconData _utilityIcon(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return Icons.bolt_rounded;
      case 'gas':
        return Icons.local_fire_department_rounded;
      case 'water':
        return Icons.water_drop_rounded;
      default:
        return Icons.analytics_outlined;
    }
  }

  static Color _utilityColor(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return AppColors.priorityHigh;
      case 'gas':
        return AppColors.priorityUrgent;
      case 'water':
        return AppColors.statusNew;
      default:
        return AppColors.primaryNavy;
    }
  }

  static Color _utilitySoftBg(String type) {
    switch (type.toLowerCase()) {
      case 'electric':
        return AppColors.priorityHigh.withValues(alpha: 0.12);
      case 'gas':
        return AppColors.priorityUrgent.withValues(alpha: 0.12);
      case 'water':
        return AppColors.statusNew.withValues(alpha: 0.12);
      default:
        return AppColors.primaryNavy.withValues(alpha: 0.10);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentYear = DateTime.now().year;
    final years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
    final filteredBudgets = budgets.where((b) {
      if (budgetMonth != 0 && b.periodMonth != budgetMonth) return false;
      if (budgetUtilityFilter != 'all' &&
          b.utilityType != budgetUtilityFilter) {
        return false;
      }
      return true;
    }).toList()
      ..sort((a, b) {
        final cmp = a.periodMonth.compareTo(b.periodMonth);
        return cmp != 0 ? cmp : a.utilityType.compareTo(b.utilityType);
      });

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: years.contains(selectedYear)
                        ? selectedYear
                        : currentYear,
                    decoration: const InputDecoration(labelText: 'Yıl'),
                    items: years
                        .map((y) => DropdownMenuItem(value: y, child: Text('$y')))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) onYearChanged(v);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<int>(
                    initialValue: budgetMonth,
                    decoration: const InputDecoration(labelText: 'Dönem (Ay)'),
                    items: List.generate(
                      months.length,
                      (idx) => DropdownMenuItem(
                        value: idx,
                        child: Text(months[idx]),
                      ),
                    ),
                    onChanged: (v) {
                      if (v != null) onMonthChanged(v);
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final entry in const [
                ('all', 'Tümü'),
                ('electric', 'Elektrik'),
                ('gas', 'Doğalgaz'),
                ('water', 'Su'),
              ]) ...[
                ChoiceChip(
                  label: Text(
                    entry.$2,
                    style: TextStyle(
                      color: budgetUtilityFilter == entry.$1
                          ? Colors.white
                          : AppColors.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                  selected: budgetUtilityFilter == entry.$1,
                  backgroundColor: AppColors.white,
                  selectedColor: AppColors.primaryNavy,
                  checkmarkColor: Colors.white,
                  side: BorderSide(
                    color: budgetUtilityFilter == entry.$1
                        ? AppColors.primaryNavy
                        : AppColors.border,
                  ),
                  onSelected: (_) => onUtilityFilterChanged(entry.$1),
                ),
                const SizedBox(width: 6),
              ],
            ],
          ),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: (budgets.isEmpty && invoices.isEmpty)
                        ? null
                        : () => showEnergyReportWizardSheet(
                              context,
                              initialYear: selectedYear,
                              initialMonth: budgetMonth,
                              initialUtilityFilter: budgetUtilityFilter,
                              initialPreset: 'budget_matrix',
                              invoices: invoices,
                              budgets: budgets,
                              meters: meters,
                            ),
                    icon: const Icon(Icons.tune_rounded, size: 18),
                    label: const Text(
                      'Rapor Sihirbazı (Tarih & Veri Seç)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: (budgets.isEmpty && invoices.isEmpty)
                      ? null
                      : () => EnergyExcelService.exportMonthlyInvoicesReport(
                            context,
                            year: selectedYear,
                            invoices: invoices,
                            budgets: budgets,
                            config: EnergyReportExportConfig.defaults(
                              year: selectedYear,
                              selectedMonth: budgetMonth,
                              utilityFilter: budgetUtilityFilter,
                              preset: 'budget_matrix',
                            ),
                          ),
                  icon: const Icon(Icons.download_outlined, size: 18),
                  label: const Text('Matris Excel'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        if (canManage)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: importingBudget ? null : onImportBudgetFile,
                          icon: const Icon(Icons.upload_outlined, size: 18),
                          label: Text(
                            importingBudget ? 'Aktarılıyor...' : 'Bütçe Yükle',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            final bytes =
                                BudgetParserService.generateSampleBudgetExcel(
                                    selectedYear);
                            EnergyExcelService.shareOrDownloadExcel(
                              bytes: Uint8List.fromList(bytes),
                              fileName:
                                  'Ornek_Butce_Sablonu_$selectedYear.xlsx',
                              text: 'Örnek Bütçe Şablonu',
                            );
                          },
                          icon: const Icon(Icons.table_view_outlined, size: 18),
                          label: const Text(
                            'Örnek Şablon',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => onOpenBudgetForm(null),
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Manuel Bütçe Ekle'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 10),
        if (filteredBudgets.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Center(
                child: Text(
                  'Seçili dönem ($selectedYear · ${months[budgetMonth]}) için bütçe kaydı yok.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ),
            ),
          )
        else
          ...filteredBudgets.map((b) {
            final matchingInvoices = invoices.where((i) =>
                i.utilityType == b.utilityType &&
                i.periodMonth == b.periodMonth);
            final actualTL = matchingInvoices.fold<double>(
                0, (s, e) => s + e.commonAmountTL);
            final actualQty = matchingInvoices.fold<double>(
                0, (s, e) => s + e.commonConsumption);
            final unit = b.utilityType == 'electric' ? 'kWh' : 'm³';
            final tlPct =
                EnergyBudgetModel.variancePercent(actualTL, b.budgetTL);
            final qtyPct = EnergyBudgetModel.variancePercent(
                actualQty, b.budgetConsumption);
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 34,
                            height: 34,
                            decoration: BoxDecoration(
                              color: _utilitySoftBg(b.utilityType),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(
                              _utilityIcon(b.utilityType),
                              color: _utilityColor(b.utilityType),
                              size: 18,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '${_utilityLabel(b.utilityType)} – ${months[b.periodMonth]} $selectedYear',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 13.5,
                              ),
                            ),
                          ),
                          if (tlPct != null) ...[
                            const SizedBox(width: 4),
                            StatusChip(
                              label:
                                  '${tlPct >= 0 ? '+' : ''}${tlPct.toStringAsFixed(1)}%',
                              color: tlPct > 0
                                  ? AppColors.priorityUrgent
                                  : AppColors.statusResolved,
                            ),
                          ],
                          if (canManage) ...[
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 32,
                                minHeight: 32,
                              ),
                              padding: EdgeInsets.zero,
                              tooltip: 'Düzenle',
                              icon: const Icon(Icons.edit_outlined, size: 18),
                              onPressed: () => onOpenBudgetForm(b),
                            ),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 32,
                                minHeight: 32,
                              ),
                              padding: EdgeInsets.zero,
                              tooltip: 'Sil',
                              icon: const Icon(
                                Icons.delete_outline,
                                size: 18,
                                color: AppColors.priorityUrgent,
                              ),
                              onPressed: () => onDeleteBudget(b),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Miktar: ${numFmt.format(b.budgetConsumption)} $unit\nGerçek: ${numFmt.format(actualQty)} $unit${qtyPct != null ? ' (${qtyPct >= 0 ? '+' : ''}${qtyPct.toStringAsFixed(1)}%)' : ''}',
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.textSecondary,
                                height: 1.35,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              'Bütçe: ${tlFmt.format(b.budgetTL)} ₺\nGerçek: ${tlFmt.format(actualTL)} ₺',
                              textAlign: TextAlign.right,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
      ],
    );
  }
}
