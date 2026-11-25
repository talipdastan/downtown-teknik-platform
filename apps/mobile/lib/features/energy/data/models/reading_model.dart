class ReadingCalculationResult {
  final double consumption;
  final double? inductivePercent;
  final double? capacitivePercent;

  const ReadingCalculationResult({
    required this.consumption,
    this.inductivePercent,
    this.capacitivePercent,
  });
}

class MeterReadingModel {
  static const double inductiveLimitPercent = 20.0;
  static const double capacitiveLimitPercent = 15.0;

  final String id;
  final String meterId;
  final DateTime readingDate;
  final double? activeValue;
  final double? inductiveValue;
  final double? capacitiveValue;
  final double? inductivePercent;
  final double? capacitivePercent;
  final double? indexValue;
  final double consumption;
  final String? enteredById;
  final String enteredByName;
  final String? notes;

  const MeterReadingModel({
    required this.id,
    required this.meterId,
    required this.readingDate,
    this.activeValue,
    this.inductiveValue,
    this.capacitiveValue,
    this.inductivePercent,
    this.capacitivePercent,
    this.indexValue,
    required this.consumption,
    this.enteredById,
    required this.enteredByName,
    this.notes,
  });

  bool get isInductivePenalty =>
      (inductivePercent ?? 0) > inductiveLimitPercent;

  bool get isCapacitivePenalty =>
      (capacitivePercent ?? 0) > capacitiveLimitPercent;

  /// Elektrik sayacı tüketim ve reaktif oran hesabı (saf Dart → test edilebilir).
  static ReadingCalculationResult calculateElectric({
    required double active,
    required double inductive,
    required double capacitive,
    required double multiplier,
    double? prevActive,
    double? prevInductive,
    double? prevCapacitive,
  }) {
    if (prevActive != null) {
      if (active < prevActive ||
          inductive < (prevInductive ?? 0) ||
          capacitive < (prevCapacitive ?? 0)) {
        throw ArgumentError('Girilen endeks önceki okumadan küçük olamaz.');
      }
      final diffAct = active - prevActive;
      final diffInd = inductive - (prevInductive ?? 0);
      final diffCap = capacitive - (prevCapacitive ?? 0);
      final consumption =
          double.parse((diffAct * multiplier).toStringAsFixed(3));
      final indPct = diffAct > 0
          ? double.parse(((diffInd / diffAct) * 100).toStringAsFixed(1))
          : 0.0;
      final capPct = diffAct > 0
          ? double.parse(((diffCap / diffAct) * 100).toStringAsFixed(1))
          : 0.0;
      return ReadingCalculationResult(
        consumption: consumption,
        inductivePercent: indPct,
        capacitivePercent: capPct,
      );
    }
    return const ReadingCalculationResult(
      consumption: 0.0,
      inductivePercent: 0.0,
      capacitivePercent: 0.0,
    );
  }

  /// Mekanik sayaç tüketim hesabı (saf Dart → test edilebilir).
  static double calculateMechanical({
    required double indexValue,
    required double multiplier,
    double? prevIndexValue,
  }) {
    if (prevIndexValue == null) return 0.0;
    if (indexValue < prevIndexValue) {
      throw ArgumentError('Girilen endeks önceki okumadan küçük olamaz.');
    }
    return double.parse(
      ((indexValue - prevIndexValue) * multiplier).toStringAsFixed(3),
    );
  }

  factory MeterReadingModel.fromJson(Map<String, dynamic> json) {
    return MeterReadingModel(
      id: json['id'] as String,
      meterId: json['meter_id'] as String? ?? '',
      readingDate:
          DateTime.tryParse(json['reading_date']?.toString() ?? '') ??
              DateTime.now(),
      activeValue: (json['active_value'] as num?)?.toDouble(),
      inductiveValue: (json['inductive_value'] as num?)?.toDouble(),
      capacitiveValue: (json['capacitive_value'] as num?)?.toDouble(),
      inductivePercent: (json['inductive_percent'] as num?)?.toDouble(),
      capacitivePercent: (json['capacitive_percent'] as num?)?.toDouble(),
      indexValue: (json['index_value'] as num?)?.toDouble(),
      consumption: (json['consumption'] as num?)?.toDouble() ?? 0.0,
      enteredById: json['entered_by_id']?.toString(),
      enteredByName: json['entered_by_name']?.toString() ?? '',
      notes: json['notes']?.toString(),
    );
  }
}
