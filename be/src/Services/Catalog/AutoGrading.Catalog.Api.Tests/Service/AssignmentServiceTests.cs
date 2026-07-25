using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Repository;
using AutoGrading.Catalog.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace AutoGrading.Catalog.Api.Tests.Service;

public class AssignmentServiceTests
{
    private static (CatalogDbContext Db, AssignmentService Service, FakeCacheService Cache) CreateService()
    {
        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CatalogDbContext(options);
        var cache = new FakeCacheService();
        var service = new AssignmentService(
            new AssignmentRepository(db, cache, NullLogger<AssignmentRepository>.Instance),
            cache,
            NullLogger<AssignmentService>.Instance);

        return (db, service, cache);
    }

    [Fact]
    public async Task GetByIdAsync_SecondCall_ServedFromCache_NotFromDb()
    {
        var (db, service, _) = CreateService();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Assignment 1", Description = "desc" };
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync();

        var first = await service.GetByIdAsync(assignment.Id, CancellationToken.None);
        Assert.NotNull(first);

        // Remove straight from the DB after the first call — if the second call still resolves this
        // assignment, it can only have come from the cache, not a DB query.
        db.Assignments.Remove(assignment);
        await db.SaveChangesAsync();

        var second = await service.GetByIdAsync(assignment.Id, CancellationToken.None);

        Assert.NotNull(second);
        Assert.Equal(assignment.Title, second!.Title);
    }

    [Fact]
    public async Task GetByIdAsync_CacheUnavailable_FallsBackToDb()
    {
        var (db, service, cache) = CreateService();
        var assignment = new Assignment { SubjectId = Guid.NewGuid(), Title = "Assignment 1" };
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync();

        cache.ThrowOnAccess = true;

        var result = await service.GetByIdAsync(assignment.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(assignment.Title, result!.Title);
    }

    [Fact]
    public async Task GetByIdAsync_UnknownId_ReturnsNull_AndDoesNotCacheNegativeResult()
    {
        var (_, service, cache) = CreateService();

        var result = await service.GetByIdAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(result);
        Assert.Equal(0, cache.SetCount);
    }
}
