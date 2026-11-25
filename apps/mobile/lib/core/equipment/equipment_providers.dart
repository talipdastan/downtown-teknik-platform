import 'package:avm_tech_platform/core/equipment/equipment_model.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tüm modüllerin ortak kullandığı ekipman listesi (`public.equipments`).
/// Modüller bu sağlayıcıyı kullanır; ekipman tablosuna kendi sorgularını yazmaz.
final equipmentOptionsProvider =
    FutureProvider.autoDispose<List<EquipmentModel>>((ref) async {
  final data = await Api.client
      .from('equipments')
      .select()
      .eq('is_active', true)
      .order('name')
      .limit(500);
  return (data as List)
      .map((e) => EquipmentModel.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();
});
