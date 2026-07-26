namespace AutoGrading.Grading.Api.Interfaces;

public enum ArtifactKindDto
{
    Report,
}

public sealed record ExtractedArtifactDto(Guid Id, ArtifactKindDto Kind, string? Content, string? Warnings, string? ImagesJson);

public sealed record SubmissionDto(Guid Id, Guid AssignmentId, Guid StudentId, List<ExtractedArtifactDto> Artifacts);

public interface ISubmissionApiClient
{
    Task<SubmissionDto?> GetSubmissionAsync(Guid submissionId, CancellationToken cancellationToken);
}
