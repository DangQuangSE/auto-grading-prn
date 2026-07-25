using AutoGrading.Catalog.Api.Domain;

namespace AutoGrading.Catalog.Api.Interfaces;

public interface IRubricService
{
    Task<List<Rubric>> ListAsync(Guid? subjectId, Guid? assignmentId, Guid? userId, bool isAdmin, CancellationToken cancellationToken);

    Task<Rubric?> GetByIdAsync(Guid id, bool includeCriteria, CancellationToken cancellationToken);

    /// <summary>Cache-aside lookup used only by <c>CatalogGrpcService.GetCriteriaForAssignment</c>: on a miss,
    /// delegates to <see cref="IRubricRepository.ListAsync"/> restricted to the Confirmed-visible view
    /// (<c>userId: null, isAdmin: false</c>) and returns the first matching rubric's criteria (empty list if none).
    /// Deliberately takes no caller identity — the cache key has none either, so the result must always be the
    /// same caller-independent view. Callers must not be given a way to see Draft criteria through this method;
    /// that path is REST's <see cref="GetByIdAsync"/> + authorization, not this one.</summary>
    Task<List<RubricCriterion>> GetCriteriaForAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken);

    /// <summary>Must be called BEFORE the endpoint uploads anything to object storage — validates scope/authorization
    /// so an unauthorized attempt never touches storage. Returns the id of the rubric this upload would replace (matched
    /// by <paramref name="assignmentId"/>), or <c>null</c> for a brand-new rubric. Throws <see cref="RubricForbiddenException"/>
    /// if a <see cref="RubricScope.SchoolWide"/> upload is attempted by a non-admin, or the caller isn't authorized for
    /// the existing rubric.</summary>
    Task<Guid?> AuthorizeUploadAsync(Guid? assignmentId, RubricScope scope, Guid userId, bool isAdmin, CancellationToken cancellationToken);

    /// <summary>Creates-or-updates the rubric's metadata row; does not touch object storage or Hangfire (the endpoint
    /// uploads the file before calling <see cref="AuthorizeUploadAsync"/> and enqueues <c>RubricParsingJob</c> after this
    /// call succeeds). <paramref name="existingRubricId"/> must be the value <see cref="AuthorizeUploadAsync"/> returned
    /// for this same upload attempt.</summary>
    Task<RubricUploadResult> UploadAsync(Guid? existingRubricId, RubricUploadRequest request, Guid userId, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogNotFoundException"/> if not found, <see cref="RubricForbiddenException"/> if not
    /// authorized, or <see cref="CatalogConflictException"/> if the rubric's status isn't <see cref="RubricStatus.Parsing"/>.
    /// Does not enqueue Hangfire — the endpoint does that after this call succeeds.</summary>
    Task<Rubric> RetryParsingAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogNotFoundException"/>, <see cref="RubricForbiddenException"/>, or
    /// <see cref="CatalogConflictException"/> if the rubric's status isn't <see cref="RubricStatus.Draft"/>.</summary>
    Task<List<RubricCriterion>> UpdateCriteriaAsync(Guid id, List<RubricCriterionInput> criteria, Guid userId, bool isAdmin, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogNotFoundException"/>, <see cref="RubricForbiddenException"/>, or
    /// <see cref="CatalogConflictException"/> if <see cref="Rubric.Confirm"/>'s status guard fails.</summary>
    Task<Rubric> ConfirmAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="CatalogNotFoundException"/>, <see cref="RubricForbiddenException"/>, or
    /// <see cref="CatalogConflictException"/> if <see cref="Rubric.Unlock"/>'s status guard fails.</summary>
    Task<Rubric> UnlockAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken);

    /// <summary>Throws <see cref="RubricForbiddenException"/> if the caller may not view the rubric. Returns <c>null</c> if
    /// not found or it has no uploaded file yet.</summary>
    Task<Rubric?> DownloadFileAsync(Guid id, Guid userId, bool isAdmin, CancellationToken cancellationToken);
}
