using AutoGrading.Catalog.Api.Caching;
using AutoGrading.Catalog.Api.Constant;
using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Interfaces;
using AutoGrading.Common.Caching;

namespace AutoGrading.Catalog.Api.Service;

public sealed class RubricService(
    IRubricRepository repo,
    ICacheService cache,
    ILogger<RubricService> logger) : IRubricService
{
    public Task<List<Rubric>> ListAsync(Guid? subjectId, Guid? assignmentId, Guid? userId, bool isAdmin, CancellationToken cancellationToken) =>
        repo.ListAsync(subjectId, assignmentId, userId, isAdmin, cancellationToken);

    public Task<Rubric?> GetByIdAsync(Guid id, bool includeCriteria, CancellationToken cancellationToken) =>
        repo.GetByIdAsync(id, includeCriteria, cancellationToken);

    public Task<List<RubricCriterion>> GetCriteriaForAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        cache.GetOrSetAsync(
            logger,
            CacheKeys.Criteria(assignmentId),
            CacheKeys.DefaultTtl,
            async ct =>
            {
                // No caller identity is threaded through: the cache key has none, so this must only ever
                // resolve the Confirmed-visible view regardless of who calls GetCriteriaForAssignmentAsync
                // (see IRubricService for the enforced invariant). userId: Guid.Empty is a sentinel that no
                // real LecturerId ever equals (Identity never issues an all-zero id), so the repository's
                // "Confirmed OR LecturerId == userId" filter collapses to Confirmed-only here — unlike
                // userId: null, which would incorrectly match Draft school-wide rubrics (LecturerId is null
                // for those until a lecturer claims them).
                var rubrics = await repo.ListAsync(subjectId: null, assignmentId, userId: Guid.Empty, isAdmin: false, ct);
                return rubrics.FirstOrDefault()?.Criteria ?? [];
            },
            cancellationToken);

    public async Task<Guid?> AuthorizeUploadAsync(Guid? assignmentId, RubricScope scope, Guid userId, bool isAdmin, CancellationToken cancellationToken)
    {
        if (scope == RubricScope.SchoolWide && !isAdmin)
        {
            throw new RubricForbiddenException();
        }

        if (assignmentId is null)
        {
            return null;
        }

        var existingRubric = await repo.GetByAssignmentIdAsync(assignmentId.Value, includeCriteria: false, cancellationToken);
        if (existingRubric is not null && !IsAuthorized(existingRubric, userId, isAdmin))
        {
            throw new RubricForbiddenException();
        }

        return existingRubric?.Id;
    }

    public async Task<RubricUploadResult> UploadAsync(Guid? existingRubricId, RubricUploadRequest request, Guid userId, CancellationToken cancellationToken)
    {
        var existingRubric = existingRubricId is null
            ? null
            : await repo.GetByIdAsync(existingRubricId.Value, includeCriteria: true, cancellationToken);

        if (existingRubric is not null)
        {
            var previousObjectKey = existingRubric.FileObjectKey;
            existingRubric.Name = request.Name;
            existingRubric.FileObjectKey = request.ObjectKey;
            existingRubric.Status = RubricStatus.Parsing;

            // Two repository calls (clear criteria, then save fields) instead of the original's single
            // SaveChanges — see the matching comment in Repository/RubricRepository.cs / Endpoints/RubricsEndpoints.cs
            // history for why this Phase-2/3 layering trade-off is low-risk here.
            await repo.UpdateCriteriaAsync(existingRubric, new List<RubricCriterion>(), cancellationToken);
            var updated = await repo.UpdateAsync(existingRubric, cancellationToken);

            return new RubricUploadResult(updated, string.IsNullOrEmpty(previousObjectKey) ? null : previousObjectKey);
        }

        var rubric = new Rubric
        {
            SubjectId = request.SubjectId,
            AssignmentId = request.AssignmentId,
            Name = request.Name,
            FileObjectKey = request.ObjectKey,
            Scope = request.Scope,
            LecturerId = request.Scope == RubricScope.SchoolWide ? null : userId,
        };
        var created = await repo.CreateAsync(rubric, cancellationToken);

        return new RubricUploadResult(created, null);
    }

    public async Task<Rubric> RetryParsingAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken)
    {
        var rubric = await LoadAuthorizedAsync(id, userId, isAdmin, includeCriteria: false, cancellationToken);

        if (rubric.Status != RubricStatus.Parsing)
        {
            throw new CatalogConflictException(
                "rubric_status_mismatch",
                string.Format(CatalogConstants.RubricStatusMismatch, id, rubric.Status, "Parsing", "re-upload instead of retrying"));
        }

        return rubric;
    }

    public async Task<List<RubricCriterion>> UpdateCriteriaAsync(
        Guid id,
        List<RubricCriterionInput> criteria,
        Guid userId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var rubric = await LoadAuthorizedAsync(id, userId, isAdmin, includeCriteria: true, cancellationToken);

        if (rubric.Status != RubricStatus.Draft)
        {
            throw new CatalogConflictException(
                "rubric_status_mismatch",
                string.Format(CatalogConstants.RubricStatusMismatch, id, rubric.Status, "Draft", "unlock it before editing criteria"));
        }

        var mapped = criteria.Select(criterion => new RubricCriterion
        {
            RubricId = rubric.Id,
            Name = criterion.Name,
            Description = criterion.Description,
            MaxScore = criterion.MaxScore,
            OrderIndex = criterion.OrderIndex,
        }).ToList();

        return await repo.UpdateCriteriaAsync(rubric, mapped, cancellationToken);
    }

    public async Task<Rubric> ConfirmAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken)
    {
        var rubric = await LoadAuthorizedAsync(id, userId, isAdmin, includeCriteria: true, cancellationToken);

        ConfirmOrUnlock(rubric.Confirm);

        return await repo.ConfirmAsync(rubric, cancellationToken);
    }

    public async Task<Rubric> UnlockAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken)
    {
        var rubric = await LoadAuthorizedAsync(id, userId, isAdmin, includeCriteria: false, cancellationToken);

        ConfirmOrUnlock(rubric.Unlock);

        return await repo.UnlockAsync(rubric, cancellationToken);
    }

    /// <summary>Wraps <see cref="Rubric.Confirm"/>/<see cref="Rubric.Unlock"/>'s <see cref="InvalidOperationException"/>
    /// (invalid status transition) into <see cref="CatalogConflictException"/>, matching every other conflict path in
    /// this service and the contract documented on <see cref="IRubricService"/>'s <c>ConfirmAsync</c>/<c>UnlockAsync</c>.</summary>
    private static void ConfirmOrUnlock(Action transition)
    {
        try
        {
            transition();
        }
        catch (InvalidOperationException ex)
        {
            throw new CatalogConflictException("rubric_status_mismatch", ex.Message);
        }
    }

    public async Task<Rubric?> DownloadFileAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken)
    {
        var rubric = await repo.DownloadFileAsync(id, cancellationToken);
        if (rubric?.FileObjectKey is null)
        {
            return null;
        }

        if (!CanView(rubric, userId, isAdmin))
        {
            throw new RubricForbiddenException();
        }

        return rubric;
    }

    private async Task<Rubric> LoadAuthorizedAsync(Guid id, Guid userId, bool isAdmin, bool includeCriteria, CancellationToken cancellationToken)
    {
        var rubric = await repo.GetByIdAsync(id, includeCriteria, cancellationToken);
        if (rubric is null)
        {
            throw new CatalogNotFoundException(null, null);
        }

        if (!IsAuthorized(rubric, userId, isAdmin))
        {
            throw new RubricForbiddenException();
        }

        return rubric;
    }

    private static bool IsAuthorized(Rubric rubric, Guid userId, bool isAdmin) =>
        isAdmin || rubric.LecturerId == userId;

    private static bool CanView(Rubric rubric, Guid userId, bool isAdmin) =>
        rubric.Status == RubricStatus.Confirmed || IsAuthorized(rubric, userId, isAdmin);
}
