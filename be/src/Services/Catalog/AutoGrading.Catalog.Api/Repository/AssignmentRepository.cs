using AutoGrading.Catalog.Api.Caching;
using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Interfaces;
using AutoGrading.Common.Caching;
using AutoGrading.Contracts.Pagination;
using Microsoft.EntityFrameworkCore;

namespace AutoGrading.Catalog.Api.Repository;

public sealed class AssignmentRepository(CatalogDbContext db, ICacheService cache, ILogger<AssignmentRepository> logger) : IAssignmentRepository
{
    public async Task<PagedResult<Assignment>> ListAsync(Guid? subjectId, int? page, int? pageSize, CancellationToken cancellationToken)
    {
        var (normalizedPage, normalizedPageSize) = PaginationDefaults.Normalize(page, pageSize);
        var query = db.Assignments.AsNoTracking().AsQueryable();
        if (subjectId is not null)
        {
            query = query.Where(a => a.SubjectId == subjectId);
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip((normalizedPage - 1) * normalizedPageSize)
            .Take(normalizedPageSize)
            .ToListAsync(cancellationToken);

        return new PagedResult<Assignment>(items, normalizedPage, normalizedPageSize, totalCount);
    }

    public Task<Assignment?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        db.Assignments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

    public async Task<Assignment> CreateAsync(Assignment assignment, CancellationToken cancellationToken)
    {
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync(cancellationToken);
        await cache.InvalidateAsync(logger, CacheKeys.Assignment(assignment.Id), cancellationToken);
        return assignment;
    }

    public async Task<Assignment?> UpdateAsync(
        Guid id,
        string title,
        string? description,
        DateTimeOffset? dueDate,
        int maxAttempts,
        CancellationToken cancellationToken)
    {
        var assignment = await db.Assignments.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
        if (assignment is null)
        {
            return null;
        }

        assignment.Title = title;
        assignment.Description = description;
        assignment.DueDate = dueDate;
        assignment.MaxAttempts = maxAttempts;
        await db.SaveChangesAsync(cancellationToken);
        await cache.InvalidateAsync(logger, CacheKeys.Assignment(id), cancellationToken);

        return assignment;
    }
}
