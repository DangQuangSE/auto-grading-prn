using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Repository;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace AutoGrading.Catalog.Api.Tests.Repository;

public class RubricRepositoryTests
{
    private static (CatalogDbContext Db, RubricRepository Repo, FakeCacheService Cache) CreateRepository()
    {
        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CatalogDbContext(options);
        var cache = new FakeCacheService();
        var repo = new RubricRepository(db, cache, NullLogger<RubricRepository>.Instance);

        return (db, repo, cache);
    }

    private static Rubric NewDraftRubric(Guid assignmentId) => new()
    {
        SubjectId = Guid.NewGuid(),
        AssignmentId = assignmentId,
        Name = "Rubric",
        Status = RubricStatus.Draft,
        LecturerId = Guid.NewGuid(),
    };

    private static string CriteriaKey(Guid assignmentId) => $"catalog:criteria:{assignmentId}";

    [Fact]
    public async Task CreateAsync_InvalidatesCriteriaCacheKey()
    {
        var (_, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        await cache.SetAsync(CriteriaKey(assignmentId), "sentinel", TimeSpan.FromMinutes(30));

        await repo.CreateAsync(rubric, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(CriteriaKey(assignmentId)));
    }

    [Fact]
    public async Task UpdateAsync_InvalidatesCriteriaCacheKey()
    {
        var (db, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();
        await cache.SetAsync(CriteriaKey(assignmentId), "sentinel", TimeSpan.FromMinutes(30));

        rubric.Name = "Renamed";
        await repo.UpdateAsync(rubric, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(CriteriaKey(assignmentId)));
    }

    [Fact]
    public async Task UpdateCriteriaAsync_InvalidatesCriteriaCacheKey()
    {
        var (db, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();
        await cache.SetAsync(CriteriaKey(assignmentId), "sentinel", TimeSpan.FromMinutes(30));

        await repo.UpdateCriteriaAsync(
            rubric,
            [new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", MaxScore = 10m, OrderIndex = 0 }],
            CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(CriteriaKey(assignmentId)));
    }

    [Fact]
    public async Task ConfirmAsync_InvalidatesCriteriaCacheKey()
    {
        var (db, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        rubric.Criteria.Add(new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", MaxScore = 10m, OrderIndex = 0 });
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();
        await cache.SetAsync(CriteriaKey(assignmentId), "sentinel", TimeSpan.FromMinutes(30));

        rubric.Confirm();
        await repo.ConfirmAsync(rubric, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(CriteriaKey(assignmentId)));
    }

    [Fact]
    public async Task UnlockAsync_InvalidatesCriteriaCacheKey()
    {
        var (db, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        rubric.Criteria.Add(new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", MaxScore = 10m, OrderIndex = 0 });
        rubric.Status = RubricStatus.Confirmed;
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();
        await cache.SetAsync(CriteriaKey(assignmentId), "sentinel", TimeSpan.FromMinutes(30));

        rubric.Unlock();
        await repo.UnlockAsync(rubric, CancellationToken.None);

        Assert.Null(await cache.GetAsync<string>(CriteriaKey(assignmentId)));
    }

    [Fact]
    public async Task ConfirmAsync_CacheInvalidationFailure_StillReturnsConfirmedRubric()
    {
        var (db, repo, cache) = CreateRepository();
        var assignmentId = Guid.NewGuid();
        var rubric = NewDraftRubric(assignmentId);
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();

        cache.ThrowOnAccess = true;
        rubric.Confirm();

        var result = await repo.ConfirmAsync(rubric, CancellationToken.None);

        Assert.Equal(RubricStatus.Confirmed, result.Status);
    }

    [Fact]
    public async Task CreateAsync_RubricWithoutAssignmentId_DoesNotThrow()
    {
        var (_, repo, _) = CreateRepository();
        var rubric = new Rubric { SubjectId = Guid.NewGuid(), Name = "SchoolWide", Scope = RubricScope.SchoolWide, AssignmentId = null };

        var result = await repo.CreateAsync(rubric, CancellationToken.None);

        Assert.NotNull(result);
    }
}
