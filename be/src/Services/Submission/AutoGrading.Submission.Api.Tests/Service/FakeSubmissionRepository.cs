using AutoGrading.SubmissionSvc.Api.Constant;
using AutoGrading.SubmissionSvc.Api.Domain;
using AutoGrading.SubmissionSvc.Api.Interfaces;

namespace AutoGrading.Submission.Api.Tests.Service;

/// <summary>Hand-rolled in-memory fake of ISubmissionRepository, modeled on the Catalog test suite's
/// FakeCacheService pattern — no EF/DB involved, just enough behavior to drive SubmissionService.</summary>
public sealed class FakeSubmissionRepository : ISubmissionRepository
{
    public readonly List<AutoGrading.SubmissionSvc.Api.Domain.Submission> Items = [];
    public int AttemptLimitToReject = -1; // if >= 0, CreateWithAttemptCheckAsync throws limit-reached
    public bool DeleteCalled;
    public Guid? ResetForRetryCalledWith;

    public Task<IReadOnlyList<AutoGrading.SubmissionSvc.Api.Domain.Submission>> ListAsync(
        Guid? assignmentId, IReadOnlyCollection<Guid>? restrictToStudentIds, Guid? studentId, CancellationToken ct)
    {
        IEnumerable<AutoGrading.SubmissionSvc.Api.Domain.Submission> query = Items;
        if (assignmentId is { } aid) query = query.Where(s => s.AssignmentId == aid);
        if (studentId is { } sid) query = query.Where(s => s.StudentId == sid);
        if (restrictToStudentIds is not null) query = query.Where(s => restrictToStudentIds.Contains(s.StudentId));

        return Task.FromResult<IReadOnlyList<AutoGrading.SubmissionSvc.Api.Domain.Submission>>(query.ToList());
    }

    public Task<AutoGrading.SubmissionSvc.Api.Domain.Submission?> GetByIdAsync(Guid id, bool includeArtifacts, CancellationToken ct) =>
        Task.FromResult(Items.SingleOrDefault(s => s.Id == id));

    public Task<AutoGrading.SubmissionSvc.Api.Domain.Submission> CreateWithAttemptCheckAsync(Guid assignmentId, Guid studentId, int maxAttempts, CancellationToken ct)
    {
        if (AttemptLimitToReject >= 0)
        {
            throw new SubmissionAttemptLimitReachedException(AttemptLimitToReject, maxAttempts);
        }

        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission
        {
            AssignmentId = assignmentId,
            StudentId = studentId,
            State = SubmissionState.Uploading,
        };
        Items.Add(submission);
        return Task.FromResult(submission);
    }

    public Task SaveUploadResultAsync(AutoGrading.SubmissionSvc.Api.Domain.Submission submission, string reportObjectKey, string? diagramObjectKey, CancellationToken ct)
    {
        submission.ReportObjectKey = reportObjectKey;
        submission.DiagramObjectKey = diagramObjectKey;
        submission.State = SubmissionState.Uploaded;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(AutoGrading.SubmissionSvc.Api.Domain.Submission submission, CancellationToken ct)
    {
        DeleteCalled = true;
        Items.Remove(submission);
        return Task.CompletedTask;
    }

    public Task ResetForRetryAsync(Guid submissionId, CancellationToken ct)
    {
        ResetForRetryCalledWith = submissionId;
        var submission = Items.Single(s => s.Id == submissionId);
        submission.State = SubmissionState.Uploaded;
        submission.Artifacts.Clear();
        return Task.CompletedTask;
    }

    public Task UpdateStateAsync(Guid submissionId, SubmissionState state, CancellationToken ct)
    {
        Items.Single(s => s.Id == submissionId).State = state;
        return Task.CompletedTask;
    }

    public Task AddExtractedArtifactAsync(Guid submissionId, ExtractedArtifact artifact, CancellationToken ct)
    {
        Items.Single(s => s.Id == submissionId).Artifacts.Add(artifact);
        return Task.CompletedTask;
    }
}
