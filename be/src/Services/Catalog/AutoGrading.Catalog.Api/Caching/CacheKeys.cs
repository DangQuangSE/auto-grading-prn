namespace AutoGrading.Catalog.Api.Caching;

/// <summary>Single source of truth for cache key formats shared between the service layer (writes on read
/// miss) and the repository layer (invalidates on write) — keeps both sides in sync without hand-typing the
/// same string format twice.</summary>
internal static class CacheKeys
{
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(30);

    public static string Assignment(Guid assignmentId) => $"catalog:assignment:{assignmentId}";

    public static string Criteria(Guid assignmentId) => $"catalog:criteria:{assignmentId}";
}
