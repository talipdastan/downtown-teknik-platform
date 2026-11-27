import 'package:avm_tech_platform/core/database/local_lookup_cache.dart';
import 'package:avm_tech_platform/core/equipment/equipment_model.dart';
import 'package:avm_tech_platform/core/network/api_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tüm modüllerin ortak kullandığı ekipman listesi (`public.equipments`).
/// Çevrimdışı bodrum/otopark erişimi için yerel read-through önbellek kullanır.
final equipmentOptionsProvider =
    FutureProvider.autoDispose<List<EquipmentModel>>((ref) async {
  final rows = await LocalLookupCache.instance.readThrough(
    key: 'equipments_active',
    fetchRemote: () async {
      final data = await Api.client
          .from('equipments')
          .select('id, code, name, equipment_type, department_id, location_id, brand, model, serial_number, warranty_end_date, status, is_active, created_at')
          .eq('is_active', true)
          .order('name')
          .limit(500);
      return (data as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
    },
  );
  return rows.map((e) => EquipmentModel.fromJson(e)).toList();
});
