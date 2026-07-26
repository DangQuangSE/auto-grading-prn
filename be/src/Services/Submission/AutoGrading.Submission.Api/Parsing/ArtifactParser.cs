using AutoGrading.SubmissionSvc.Api.Domain;
using AutoGrading.SubmissionSvc.Api.Interfaces;

namespace AutoGrading.SubmissionSvc.Api.Parsing;

/// <summary>Dispatches to the concrete parser for the given artifact kind.</summary>
public sealed class ArtifactParser(DocxReportParser reportParser) : IArtifactParser
{
    public Task<ParsedArtifact> ParseAsync(ArtifactKind kind, Stream stream, string objectKey, CancellationToken cancellationToken = default) =>
        kind switch
        {
            ArtifactKind.Report => reportParser.ParseAsync(stream, objectKey, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unsupported artifact kind."),
        };
}
