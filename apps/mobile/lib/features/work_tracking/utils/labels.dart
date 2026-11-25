/// Saf Dart etiket yardımcıları (Flutter bağımlılığı yok → birim test edilebilir).
class Labels {
  Labels._();

  static String ticketStatus(String s) {
    switch (s) {
      case 'new':
        return 'Yeni';
      case 'under_review':
        return 'İnceleniyor';
      case 'assigned':
        return 'Atandı';
      case 'in_progress':
        return 'İşlemde';
      case 'waiting':
        return 'Beklemede';
      case 'resolved':
        return 'Çözüldü (Onay Bekliyor)';
      case 'closed':
        return 'Kapatıldı';
      case 'cancelled':
        return 'İptal Edildi';
      default:
        return s;
    }
  }

  static String priority(String p) {
    switch (p) {
      case 'normal':
        return 'Normal';
      case 'priority':
        return 'Öncelikli';
      case 'urgent':
        return 'Acil';
      default:
        return p;
    }
  }

  static String workOrderStatus(String s) {
    switch (s) {
      case 'assigned':
        return 'Atandı';
      case 'in_progress':
        return 'İşlemde';
      case 'waiting':
        return 'Beklemede';
      case 'completed':
        return 'Tamamlandı';
      case 'cancelled':
        return 'İptal Edildi';
      default:
        return s;
    }
  }

  static String role(String r) {
    switch (r) {
      case 'employee':
        return 'Personel';
      case 'technician':
        return 'Teknisyen';
      case 'team_lead':
        return 'Ekip Lideri';
      case 'technical_manager':
        return 'Teknik Müdür';
      case 'system_admin':
        return 'Sistem Yöneticisi';
      default:
        return r;
    }
  }

  static String approval(String a) {
    switch (a) {
      case 'pending':
        return 'Onay Bekliyor';
      case 'approved':
        return 'Onaylı';
      case 'rejected':
        return 'Reddedildi';
      case 'disabled':
        return 'Devre Dışı';
      default:
        return a;
    }
  }
}
