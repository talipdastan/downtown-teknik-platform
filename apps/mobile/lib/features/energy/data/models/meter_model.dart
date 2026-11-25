class MeterModel {
  final String id;
  final String? legacyId;
  final String name;
  final String meterType; // 'electric' | 'mechanical'
  final String category; // 'electric' | 'water' | 'cooling' | 'gas' | 'other'
  final double multiplier;
  final int sortOrder;
  final String? meterNo;
  final String? contractNo;
  final String? eicCode;
  final String? tekilCode;
  final String? subscriberNo;
  final String? region;
  final String? equipmentId;
  final String? equipmentCode;
  final String? equipmentName;
  final bool isActive;

  const MeterModel({
    required this.id,
    this.legacyId,
    required this.name,
    required this.meterType,
    required this.category,
    this.multiplier = 1.0,
    this.sortOrder = 0,
    this.meterNo,
    this.contractNo,
    this.eicCode,
    this.tekilCode,
    this.subscriberNo,
    this.region,
    this.equipmentId,
    this.equipmentCode,
    this.equipmentName,
    this.isActive = true,
  });

  bool get isElectric => meterType == 'electric';

  /// İsimden varsayılan alt kategori tahmini (mevcut sayac_takip_app mantığı).
  static String inferCategory(String meterType, String name) {
    if (meterType == 'electric') return 'electric';
    final lower = name.toLowerCase();
    if (lower.contains('şebeke') || lower.contains('sebeke')) return 'water';
    if (lower.contains('kule')) return 'cooling';
    if (lower.contains('doğalgaz') ||
        lower.contains('dogalgaz') ||
        lower.contains('kazan') ||
        lower.contains('radyant')) {
      return 'gas';
    }
    return 'other';
  }

  factory MeterModel.fromJson(Map<String, dynamic> json) {
    final type = json['meter_type'] as String? ?? 'electric';
    final name = json['name'] as String? ?? '';
    final eq = json['equipments'] is Map ? json['equipments'] as Map : null;
    return MeterModel(
      id: json['id'] as String,
      legacyId: json['legacy_id'] as String?,
      name: name,
      meterType: type,
      category: json['category'] as String? ?? inferCategory(type, name),
      multiplier: (json['multiplier'] as num?)?.toDouble() ?? 1.0,
      sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
      meterNo: json['meter_no']?.toString(),
      contractNo: json['contract_no']?.toString(),
      eicCode: json['eic_code']?.toString(),
      tekilCode: json['tekil_code']?.toString(),
      subscriberNo: json['subscriber_no']?.toString(),
      region: json['region']?.toString(),
      equipmentId: json['equipment_id']?.toString(),
      equipmentCode: eq?['code']?.toString(),
      equipmentName: eq?['name']?.toString(),
      isActive: json['is_active'] as bool? ?? true,
    );
  }
}

class EnergyDashboardItem {
  final String meterId;
  final String meterName;
  final String meterType;
  final String category;
  final double multiplier;
  final int sortOrder;
  final String? equipmentId;
  final String? equipmentCode;
  final String? equipmentName;
  final DateTime? latestReadingDate;
  final double? latestConsumption;
  final double? latestInductivePercent;
  final double? latestCapacitivePercent;
  final double monthlyTotalConsumption;

  const EnergyDashboardItem({
    required this.meterId,
    required this.meterName,
    required this.meterType,
    required this.category,
    required this.multiplier,
    required this.sortOrder,
    this.equipmentId,
    this.equipmentCode,
    this.equipmentName,
    this.latestReadingDate,
    this.latestConsumption,
    this.latestInductivePercent,
    this.latestCapacitivePercent,
    required this.monthlyTotalConsumption,
  });

  bool get hasInductivePenalty =>
      meterType == 'electric' && (latestInductivePercent ?? 0) > 20.0;
  bool get hasCapacitivePenalty =>
      meterType == 'electric' && (latestCapacitivePercent ?? 0) > 15.0;

  factory EnergyDashboardItem.fromJson(Map<String, dynamic> json) {
    return EnergyDashboardItem(
      meterId: json['meter_id'] as String,
      meterName: json['meter_name'] as String? ?? '',
      meterType: json['meter_type'] as String? ?? 'electric',
      category: json['category'] as String? ?? 'electric',
      multiplier: (json['multiplier'] as num?)?.toDouble() ?? 1.0,
      sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
      equipmentId: json['equipment_id']?.toString(),
      equipmentCode: json['equipment_code']?.toString(),
      equipmentName: json['equipment_name']?.toString(),
      latestReadingDate: json['latest_reading_date'] != null
          ? DateTime.tryParse(json['latest_reading_date'].toString())
          : null,
      latestConsumption: (json['latest_consumption'] as num?)?.toDouble(),
      latestInductivePercent:
          (json['latest_inductive_percent'] as num?)?.toDouble(),
      latestCapacitivePercent:
          (json['latest_capacitive_percent'] as num?)?.toDouble(),
      monthlyTotalConsumption:
          (json['monthly_total_consumption'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class TrashedMeterItem {
  final String id;
  final String name;
  final String meterType;
  final String category;
  final double multiplier;
  final DateTime deletedAt;
  final String? deletedBy;
  final String deletedByName;
  final int readingsCount;
  final DateTime purgeAt;

  const TrashedMeterItem({
    required this.id,
    required this.name,
    required this.meterType,
    required this.category,
    required this.multiplier,
    required this.deletedAt,
    this.deletedBy,
    required this.deletedByName,
    required this.readingsCount,
    required this.purgeAt,
  });

  int get daysRemaining {
    final diff = purgeAt.difference(DateTime.now().toUtc());
    if (diff.isNegative) return 0;
    return (diff.inHours / 24).ceil();
  }

  factory TrashedMeterItem.fromJson(Map<String, dynamic> json) {
    final deletedAt =
        DateTime.tryParse(json['deleted_at']?.toString() ?? '') ??
            DateTime.now().toUtc();
    final purgeAt = DateTime.tryParse(json['purge_at']?.toString() ?? '') ??
        deletedAt.add(const Duration(days: 30));
    return TrashedMeterItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      meterType: json['meter_type'] as String? ?? 'electric',
      category: json['category'] as String? ?? 'other',
      multiplier: (json['multiplier'] as num?)?.toDouble() ?? 1.0,
      deletedAt: deletedAt,
      deletedBy: json['deleted_by']?.toString(),
      deletedByName: json['deleted_by_name']?.toString() ?? 'Sistem',
      readingsCount: (json['readings_count'] as num?)?.toInt() ?? 0,
      purgeAt: purgeAt,
    );
  }
}
