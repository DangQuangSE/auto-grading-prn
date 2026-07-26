using System.Text.Json;
using AutoGrading.Common.Messaging;
using AutoGrading.Common.Storage;
using AutoGrading.Contracts.Events;
using AutoGrading.SubmissionSvc.Api.Domain;
using AutoGrading.SubmissionSvc.Api.Interfaces;

namespace AutoGrading.SubmissionSvc.Api.Jobs;

/// <summary>
/// Hangfire background job: extracts artifacts from an uploaded submission's report/diagram
/// files, moving it through the Uploaded -> Extracting -> Extracted (or Failed) state machine.
/// </summary>
public sealed class ExtractionJob(
    ISubmissionRepository repository,
    IObjectStorage storage,
    IArtifactParser parser,
    IEventBus eventBus)
{
    public async Task ExecuteAsync(Guid submissionId, CancellationToken cancellationToken = default)
    {
        var submission = await repository.GetByIdAsync(submissionId, includeArtifacts: true, cancellationToken);

        if (submission is null)
        {
            return;
        }

        await repository.UpdateStateAsync(submissionId, SubmissionState.Extracting, cancellationToken);

        await eventBus.PublishAsync(
            new SubmissionStatusChanged(submission.Id, submission.StudentId, "Extracting"),
            cancellationToken);

        var warnings = new List<string>();
        var success = true;

        try
        {
            var artifacts = new List<(ArtifactKind Kind, string ObjectKey)>
            {
                (ArtifactKind.Report, submission.ReportObjectKey),
            };

            foreach (var (kind, objectKey) in artifacts)
            {
                await using var stream = await storage.DownloadAsync(objectKey, cancellationToken);
                var parsed = await parser.ParseAsync(kind, stream, objectKey, cancellationToken);

                await repository.AddExtractedArtifactAsync(submissionId, new ExtractedArtifact
                {
                    SubmissionId = submission.Id,
                    Kind = kind,
                    Content = parsed.Content,
                    Warnings = parsed.Warnings.Length > 0 ? string.Join("; ", parsed.Warnings) : null,
                    ImagesJson = parsed.ImageDataUrls is { Length: > 0 }
                        ? JsonSerializer.Serialize(parsed.ImageDataUrls)
                        : null,
                }, cancellationToken);
                warnings.AddRange(parsed.Warnings);
            }
        }
        catch (Exception ex)
        {
            success = false;
            warnings.Add(ex.Message);
        }

        await repository.UpdateStateAsync(submissionId, success ? SubmissionState.Extracted : SubmissionState.Failed, cancellationToken);

        await eventBus.PublishAsync(
            new ArtifactsExtracted(submission.Id, submission.AssignmentId, success, warnings.ToArray()),
            cancellationToken);

        if (!success)
        {
            await eventBus.PublishAsync(
                new SubmissionStatusChanged(submission.Id, submission.StudentId, "ExtractionFailed", string.Join("; ", warnings)),
                cancellationToken);
        }
    }
}
