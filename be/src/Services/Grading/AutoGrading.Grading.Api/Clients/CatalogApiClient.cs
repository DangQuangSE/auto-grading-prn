using System.Globalization;
using AutoGrading.Catalog.Api.Grpc;
using AutoGrading.Grading.Api.Interfaces;
using Grpc.Core;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

namespace AutoGrading.Grading.Api.Clients;

public sealed class CatalogApiClient(CatalogGrpcClient client) : ICatalogApiClient
{
    public async Task<IReadOnlyList<RubricCriterionDto>> GetCriteriaForAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        var reply = await client.GetCriteriaForAssignmentAsync(
            new GetCriteriaForAssignmentRequest { AssignmentId = assignmentId.ToString() },
            cancellationToken: cancellationToken);

        return reply.Criteria.Select(ToDto).ToList();
    }

    public async Task<AssignmentDto?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        try
        {
            var reply = await client.GetAssignmentAsync(
                new GetAssignmentRequest { AssignmentId = assignmentId.ToString() },
                cancellationToken: cancellationToken);

            return new AssignmentDto(
                Guid.Parse(reply.Id), Guid.Parse(reply.SubjectId), reply.Title, reply.HasDescription ? reply.Description : null);
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

    private static RubricCriterionDto ToDto(RubricCriterionReply reply) =>
        new(
            Guid.Parse(reply.Id),
            reply.Code,
            reply.Name,
            reply.HasDescription ? reply.Description : null,
            decimal.Parse(reply.MaxScore, CultureInfo.InvariantCulture),
            reply.OrderIndex);
}
