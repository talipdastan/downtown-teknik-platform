class EnergyBudgetModel {
  final String? id;
  final int periodYear;
  final int periodMonth; // 1..12
  final String utilityType; // 'electric' | 'gas' | 'water'
  final double budgetConsumption;
  final double budgetTL;
  final double prevYearConsumption;
  final double prevYearTL;

  const EnergyBudgetModel({
    this.id,
    required this.periodYear,
    required this.periodMonth,
    required this.utilityType,
    this.budgetConsumption = 0.0,
    this.budgetTL = 0.0,
    this.prevYearConsumption = 0.0,
    this.prevYearTL = 0.0,
  });

  static double? variancePercent(double actual, double target) {
    if (target <= 0) return null;
    return ((actual - target) / target) * 100.0;
  }

  Map<String, dynamic> toUpsertJson({String? updatedById}) {
    return {
      'period_year': periodYear,
      'period_month': periodMonth,
      'utility_type': utilityType,
      'budget_consumption': budgetConsumption,
      'budget_tl': budgetTL,
      'prev_year_consumption': prevYearConsumption,
      'prev_year_tl': prevYearTL,
      if (updatedById != null) 'updated_by_id': updatedById,
    };
  }

  factory EnergyBudgetModel.fromJson(Map<String, dynamic> json) {
    return EnergyBudgetModel(
      id: json['id']?.toString(),
      periodYear: (json['period_year'] as num?)?.toInt() ?? DateTime.now().year,
      periodMonth: (json['period_month'] as num?)?.toInt() ?? 1,
      utilityType: json['utility_type']?.toString() ?? 'electric',
      budgetConsumption: (json['budget_consumption'] as num?)?.toDouble() ?? 0.0,
      budgetTL: (json['budget_tl'] as num?)?.toDouble() ?? 0.0,
      prevYearConsumption:
          (json['prev_year_consumption'] as num?)?.toDouble() ?? 0.0,
      prevYearTL: (json['prev_year_tl'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
