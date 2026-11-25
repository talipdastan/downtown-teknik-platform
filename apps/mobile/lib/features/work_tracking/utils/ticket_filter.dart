import 'package:avm_tech_platform/features/work_tracking/data/models/ticket_model.dart';

/// Arıza listesi için saf Dart filtre/arama mantığı.
class TicketFilter {
  TicketFilter._();

  /// [status] ve [priority] null ise o filtre uygulanmaz.
  /// [query], ticket_number veya description içinde (büyük/küçük harf duyarsız) aranır.
  static List<TicketModel> apply(
    List<TicketModel> tickets, {
    String? status,
    String? priority,
    String query = '',
  }) {
    final q = query.trim().toLowerCase();
    return tickets.where((t) {
      if (status != null && t.status != status) return false;
      if (priority != null && t.priority != priority) return false;
      if (q.isNotEmpty) {
        final number = (t.ticketNumber ?? '').toLowerCase();
        final desc = t.description.toLowerCase();
        if (!number.contains(q) && !desc.contains(q)) return false;
      }
      return true;
    }).toList();
  }
}
