/// Tüm modüllerin (Enerji, İş Takip, Planlı Bakım, Doküman) ortak referans
/// alacağı merkezi ekipman modeli (`public.equipments`).
class EquipmentModel {
  final String id;
  final String code;
  final String name;
  final String equipmentType;
  final String? departmentId;
  final String? locationId;
  final String? brand;
  final String? model;
  final String? serialNumber;
  final DateTime? warrantyEndDate;
  final String status;
  final bool isActive;

  const EquipmentModel({
    required this.id,
    required this.code,
    required this.name,
    required this.equipmentType,
    this.departmentId,
    this.locationId,
    this.brand,
    this.model,
    this.serialNumber,
    this.warrantyEndDate,
    this.status = 'active',
    this.isActive = true,
  });

  factory EquipmentModel.fromJson(Map<String, dynamic> json) {
    return EquipmentModel(
      id: json['id'] as String,
      code: json['code'] as String,
      name: json['name'] as String,
      equipmentType: json['equipment_type'] as String? ?? 'other',
      departmentId: json['department_id'] as String?,
      locationId: json['location_id'] as String?,
      brand: json['brand'] as String?,
      model: json['model'] as String?,
      serialNumber: json['serial_number'] as String?,
      warrantyEndDate: json['warranty_end_date'] != null
          ? DateTime.tryParse(json['warranty_end_date'].toString())
          : null,
      status: json['status'] as String? ?? 'active',
      isActive: json['is_active'] as bool? ?? true,
    );
  }
}
