using AutoGrading.Catalog.Api.Grpc;
using AutoGrading.SubmissionSvc.Api.Interfaces;
using Grpc.Core;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

namespace AutoGrading.SubmissionSvc.Api.Clients;

public sealed class CatalogApiClient(CatalogGrpcClient client) : ICatalogApiClient
{
    public async Task<AssignmentDto?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        try
        {
            var reply = await client.GetAssignmentAsync(
                new GetAssignmentRequest { AssignmentId = assignmentId.ToString() },
                cancellationToken: cancellationToken);

            return new AssignmentDto(Guid.Parse(reply.Id), Guid.Parse(reply.SubjectId), reply.MaxAttempts);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<HashSet<Guid>> GetLecturerStudentIdsAsync(Guid lecturerId, Guid subjectId, CancellationToken cancellationToken)
    {
        var reply = await client.GetLecturerStudentIdsAsync(
            new GetLecturerStudentIdsRequest { SubjectId = subjectId.ToString(), LecturerId = lecturerId.ToString() },
            cancellationToken: cancellationToken);

        return [.. reply.StudentIds.Select(Guid.Parse)];
    }
}
