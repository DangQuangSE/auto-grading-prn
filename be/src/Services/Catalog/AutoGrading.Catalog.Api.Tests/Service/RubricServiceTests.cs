using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Repository;
using AutoGrading.Catalog.Api.Service;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace AutoGrading.Catalog.Api.Tests.Service;

public class RubricServiceTests
{
    private static (CatalogDbContext Db, RubricService Service, FakeCacheService Cache) CreateService()
    {
        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CatalogDbContext(options);
        var cache = new FakeCacheService();
        var service = new RubricService(
            new RubricRepository(db, cache, NullLogger<RubricRepository>.Instance),
            cache,
            NullLogger<RubricService>.Instance);

        return (db, service, cache);
    }

    private static Rubric CreateConfirmedRubric(Guid assignmentId)
    {
        var rubric = new Rubric
        {
            SubjectId = Guid.NewGuid(),
            AssignmentId = assignmentId,
            Name = "Confirmed rubric",
            Status = RubricStatus.Confirmed,
            LecturerId = Guid.NewGuid(),
        };
        rubric.Criteria.Add(new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", MaxScore = 10m, OrderIndex = 0 });
        return rubric;
    }

    [Fact]
    public async Task GetCriteriaForAssignmentAsync_SecondCall_ServedFromCache_NotFromDb()
    {
        var (db, service, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        var rubric = CreateConfirmedRubric(assignmentId);
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();

        var first = await service.GetCriteriaForAssignmentAsync(assignmentId, CancellationToken.None);
        Assert.Single(first);

        // Remove straight from the DB after the first call — if the second call still resolves criteria,
        // it can only have come from the cache, not a DB query.
        db.Rubrics.Remove(rubric);
        await db.SaveChangesAsync();

        var second = await service.GetCriteriaForAssignmentAsync(assignmentId, CancellationToken.None);

        var criterion = Assert.Single(second);
        Assert.Equal("Criterion 1", criterion.Name);
    }

    [Fact]
    public async Task GetCriteriaForAssignmentAsync_CacheUnavailable_FallsBackToDb()
    {
        var (db, service, cache) = CreateService();
        var assignmentId = Guid.NewGuid();
        var rubric = CreateConfirmedRubric(assignmentId);
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();

        cache.ThrowOnAccess = true;

        var result = await service.GetCriteriaForAssignmentAsync(assignmentId, CancellationToken.None);

        Assert.Single(result);
    }

    [Fact]
    public async Task GetCriteriaForAssignmentAsync_NoMatchingRubric_ReturnsEmptyList_AndCachesIt()
    {
        var (_, service, cache) = CreateService();

        var result = await service.GetCriteriaForAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Empty(result);
        Assert.Equal(1, cache.SetCount);
    }
}
