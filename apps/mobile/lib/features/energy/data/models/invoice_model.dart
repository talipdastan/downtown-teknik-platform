class EnergyInvoiceModel {
  final String id;
  final int periodYear;
  final int periodMonth;
  final String utilityType; // 'electric' | 'gas' | 'water'
  final String provider;
  final String? invoiceNo;
  final DateTime? invoiceDate;
  final String invoiceType; // 'normal' | 'late_fee'
  final String? meterId;
  final String meterName;
  final String? meterNo;
  final String? contractNo;
  final String? eicCode;
  final String? tekilCode;
  final String? subscriberNo;
  final double consumption;
  final double amountTL;
  final double inductivePenaltyTL;
  final double capacitivePenaltyTL;
  final double? tenantConsumption;
  final double? tenantAmountTL;
  final String? pdfStoragePath;
  final String? notes;
  final String enteredByName;
  final DateTime createdAt;

  const EnergyInvoiceModel({
    required this.id,
    required this.periodYear,
    required this.periodMonth,
    required this.utilityType,
    required this.provider,
    this.invoiceNo,
    this.invoiceDate,
    this.invoiceType = 'normal',
    this.meterId,
    required this.meterName,
    this.meterNo,
    this.contractNo,
    this.eicCode,
    this.tekilCode,
    this.subscriberNo,
    required this.consumption,
    required this.amountTL,
    this.inductivePenaltyTL = 0.0,
    this.capacitivePenaltyTL = 0.0,
    this.tenantConsumption,
    this.tenantAmountTL,
    this.pdfStoragePath,
    this.notes,
    required this.enteredByName,
    required this.createdAt,
  });

  double get unitPrice => consumption > 0 ? amountTL / consumption : 0.0;
  double get totalPenaltyTL => inductivePenaltyTL + capacitivePenaltyTL;
  double get commonConsumption =>
      (consumption - (tenantConsumption ?? 0.0)).clamp(0.0, double.infinity);
  double get commonAmountTL =>
      (amountTL - (tenantAmountTL ?? 0.0)).clamp(0.0, double.infinity);

  String get primaryIdentifier => buildGroupKey(
        utilityType: utilityType,
        eicCode: eicCode,
        tekilCode: tekilCode,
        meterNo: meterNo,
        contractNo: contractNo,
        fallbackName: meterName,
      );

  static String? normalizeMeterNo(String? raw) {
    if (raw == null) return null;
    final cleaned = raw.trim().replaceFirst(RegExp(r'^-+'), '');
    if (cleaned.isEmpty) return null;
    return cleaned.replaceFirst(RegExp(r'^60+'), '60');
  }

  static String? cleanCode(String? raw) {
    if (raw == null) return null;
    final cleaned = raw.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    return cleaned.isEmpty ? null : cleaned;
  }

  /// Elektrik: EIC -> Tekil -> SayaçNo -> Sözleşme -> İsim. Su/Gaz: SayaçNo -> Sözleşme -> İsim.
  static String buildGroupKey({
    required String utilityType,
    String? eicCode,
    String? tekilCode,
    String? meterNo,
    String? contractNo,
    required String fallbackName,
  }) {
    if (utilityType == 'electric') {
      final eic = cleanCode(eicCode);
      if (eic != null) return 'EIC_$eic';
      final tekil = cleanCode(tekilCode);
      if (tekil != null) return 'TEKIL_$tekil';
    }
    final normMeter = normalizeMeterNo(meterNo);
    if (normMeter != null) return 'METER_$normMeter';
    final cleanContract = contractNo?.trim();
    if (cleanContract != null && cleanContract.isNotEmpty) {
      return 'CONTRACT_$cleanContract';
    }
    return fallbackName;
  }

  factory EnergyInvoiceModel.fromJson(Map<String, dynamic> json) {
    return EnergyInvoiceModel(
      id: json['id'] as String,
      periodYear: (json['period_year'] as num?)?.toInt() ?? DateTime.now().year,
      periodMonth:
          (json['period_month'] as num?)?.toInt() ?? DateTime.now().month,
      utilityType: json['utility_type']?.toString() ?? 'electric',
      provider: json['provider']?.toString() ?? '',
      invoiceNo: json['invoice_no']?.toString(),
      invoiceDate: json['invoice_date'] != null
          ? DateTime.tryParse(json['invoice_date'].toString())
          : null,
      invoiceType: json['invoice_type']?.toString() ?? 'normal',
      meterId: json['meter_id']?.toString(),
      meterName: json['meter_name']?.toString() ?? '',
      meterNo: json['meter_no']?.toString(),
      contractNo: json['contract_no']?.toString(),
      eicCode: json['eic_code']?.toString(),
      tekilCode: json['tekil_code']?.toString(),
      subscriberNo: json['subscriber_no']?.toString(),
      consumption: (json['consumption'] as num?)?.toDouble() ?? 0.0,
      amountTL: (json['amount_tl'] as num?)?.toDouble() ?? 0.0,
      inductivePenaltyTL:
          (json['inductive_penalty_tl'] as num?)?.toDouble() ?? 0.0,
      capacitivePenaltyTL:
          (json['capacitive_penalty_tl'] as num?)?.toDouble() ?? 0.0,
      tenantConsumption: (json['tenant_consumption'] as num?)?.toDouble(),
      tenantAmountTL: (json['tenant_amount_tl'] as num?)?.toDouble(),
      pdfStoragePath: json['pdf_storage_path']?.toString(),
      notes: json['notes']?.toString(),
      enteredByName: json['entered_by_name']?.toString() ?? '',
      createdAt:
          DateTime.tryParse(json['created_at']?.toString() ?? '') ??
              DateTime.now(),
    );
  }
}

/// PDF'ten çıkarılan ve onay bekleyen taslak fatura.
class ParsedInvoiceDraft {
  String provider;
  String utilityType;
  String invoiceType;
  String? invoiceNo;
  DateTime? invoiceDate;
  int year;
  int month;
  String? meterNo;
  String? contractNo;
  String? eicCode;
  String? tekilCode;
  String? subscriberNo;
  String? addressHint;
  double consumption;
  double amountTL;
  double inductivePenaltyTL;
  double capacitivePenaltyTL;
  String? matchedMeterId;
  String meterName;
  double? tenantConsumption;
  double? tenantAmountTL;
  String? warningMessage;
  bool isSelected;
  bool hasMeterConflict;
  String? conflictMessage;

  /// 'unset' | 'merge' | 'separate' | 'overwrite' | 'skip'
  String conflictAction;

  ParsedInvoiceDraft({
    required this.provider,
    required this.utilityType,
    this.invoiceType = 'normal',
    this.invoiceNo,
    this.invoiceDate,
    required this.year,
    required this.month,
    this.meterNo,
    this.contractNo,
    this.eicCode,
    this.tekilCode,
    this.subscriberNo,
    this.addressHint,
    required this.consumption,
    required this.amountTL,
    this.inductivePenaltyTL = 0.0,
    this.capacitivePenaltyTL = 0.0,
    this.matchedMeterId,
    required this.meterName,
    this.tenantConsumption,
    this.tenantAmountTL,
    this.warningMessage,
    this.isSelected = true,
    this.hasMeterConflict = false,
    this.conflictMessage,
    this.conflictAction = 'unset',
  });

  String get primaryGroupKey => EnergyInvoiceModel.buildGroupKey(
        utilityType: utilityType,
        eicCode: eicCode,
        tekilCode: tekilCode,
        meterNo: meterNo,
        contractNo: contractNo,
        fallbackName: meterName,
      );

  Map<String, dynamic> toInsertJson({
    required String enteredById,
    required String enteredByName,
  }) {
    return {
      'period_year': year,
      'period_month': month,
      'utility_type': utilityType,
      'provider': provider,
      'invoice_no': invoiceNo,
      'invoice_date': invoiceDate?.toIso8601String().split('T').first,
      'invoice_type': invoiceType,
      'meter_id': matchedMeterId,
      'meter_name': meterName,
      'meter_no': meterNo,
      'contract_no': contractNo,
      'eic_code': eicCode,
      'tekil_code': tekilCode,
      'subscriber_no': subscriberNo,
      'consumption': consumption,
      'amount_tl': amountTL,
      'inductive_penalty_tl': inductivePenaltyTL,
      'capacitive_penalty_tl': capacitivePenaltyTL,
      'tenant_consumption': tenantConsumption,
      'tenant_amount_tl': tenantAmountTL,
      'notes': addressHint,
      'entered_by_id': enteredById,
      'entered_by_name': enteredByName,
    };
  }
}
