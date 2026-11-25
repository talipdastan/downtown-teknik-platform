/// Sunucu taraflı sayfalama için ortak veri modeli ve sınır doğrulama yardımcısı.
int clampPageLimit(int limit) => limit.clamp(1, 100);

int clampPageOffset(int offset) => offset < 0 ? 0 : offset;

class PaginatedResult<T> {
  final List<T> items;
  final int totalCount;
  final int limit;
  final int offset;

  const PaginatedResult({
    required this.items,
    required this.totalCount,
    required this.limit,
    required this.offset,
  });

  bool get hasMore => offset + items.length < totalCount;
}
