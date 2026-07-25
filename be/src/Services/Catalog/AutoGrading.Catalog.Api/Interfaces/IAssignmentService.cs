using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Contracts.Pagination;

namespace AutoGrading.Catalog.Api.Interfaces;

public interface IAssignmentService
{
    Task<PagedResult<Assignment>> ListAsync(Guid? subjectId, int? page, int? pageSize, CancellationToken cancellationToken);

    /// <summary>Cache-aside: reads through Redis (30-minute TTL) before falling back to the DB. A cache miss or
    /// Redis being unreachable transparently falls back to the DB read — never fails the call (FR-05).</summary>
    Task<Assignment?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogValidationException"/> if <paramref name="maxAttempts"/> &lt; 1.</summary>
    Task<Assignment> CreateAsync(Guid subjectId, string title, string? description, DateTimeOffset? dueDate, int maxAttempts, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogValidationException"/> if <paramref name="maxAttempts"/> &lt; 1. Returns <c>null</c> if not found.</summary>
    Task<Assignment?> UpdateAsync(Guid id, string title, string? description, DateTimeOffset? dueDate, int maxAttempts, CancellationToken cancellationToken);
}
