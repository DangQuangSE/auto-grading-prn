using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Repository;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace AutoGrading.Catalog.Api.Tests.Repository;

public class AssignmentRepositoryTests
{
    private static (CatalogDbContext Db, AssignmentRepository Repo, FakeCacheService Cache) CreateRepository()
    {
        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CatalogDbContext(options);
        var cache = new FakeCacheService();
        var repo = new AssignmentRepository(db, cache, NullLogger<AssignmentRepository>.Instance);

        return (db, repo, cache);
    }

    private static string CacheKey(Guid assignmentId) => $"catalog:assignment:{assignmentId}";

    [Fact]
    public async Task CreateAsync_InvalidatesAssignmentCacheKey()
    {
        var (_, repo, cache) = CreateRepository();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Assignment 1", MaxAttempts = 1 };
        var key = CacheKey(assignment.Id);
        await cache.SetAsync(key, "sentinel", TimeSpan.FromMinutes(30));

        await repo.CreateAsync(assignment, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(key));
    }

    [Fact]
    public async Task UpdateAsync_InvalidatesAssignmentCacheKey()
    {
        var (db, repo, cache) = CreateRepository();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Original", MaxAttempts = 1 };
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync();

        var key = CacheKey(assignment.Id);
        await cache.SetAsync(key, "sentinel", TimeSpan.FromMinutes(30));

        await repo.UpdateAsync(assignment.Id, "Updated", "desc", null, 2, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(key));
    }

    [Fact]
    public async Task UpdateAsync_UnknownId_DoesNotThrow_AndLeavesCacheUntouched()
    {
        var (_, repo, cache) = CreateRepository();
        var unknownId = Guid.NewGuid();
        var key = CacheKey(unknownId);
        await cache.SetAsync(key, "sentinel", TimeSpan.FromMinutes(30));

        var result = await repo.UpdateAsync(unknownId, "Updated", "desc", null, 2, CancellationToken.None);

        Assert.Null(result);
        Assert.Equal("sentinel", await cache.GetAsync<string>(key));
    }

    [Fact]
    public async Task CreateAsync_CacheInvalidationFailure_StillReturnsCreatedAssignment()
    {
        var (_, repo, cache) = CreateRepository();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Assignment 1", MaxAttempts = 1 };
        cache.ThrowOnAccess = true;

        var result = await repo.CreateAsync(assignment, CancellationToken.None);

        Assert.Equal(assignment.Id, result.Id);
    }

    [Fact]
    public async Task UpdateAsync_CacheInvalidationFailure_StillReturnsUpdatedAssignment()
    {
        var (db, repo, cache) = CreateRepository();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Original", MaxAttempts = 1 };
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync();

        cache.ThrowOnAccess = true;

        var result = await repo.UpdateAsync(assignment.Id, "Updated", "desc", null, 2, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Updated", result!.Title);
    }
}
