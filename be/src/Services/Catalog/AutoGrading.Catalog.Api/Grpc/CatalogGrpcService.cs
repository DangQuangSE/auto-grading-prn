using System.Globalization;
using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Interfaces;
using AutoGrading.Common.Auth;
using global::Grpc.Core;
using Microsoft.AspNetCore.Authorization;

namespace AutoGrading.Catalog.Api.Grpc;

/// <summary>Thin gRPC adapter for the 3 lookups Grading needs — every RPC delegates to the same
/// <see cref="IAssignmentService"/>/<see cref="IRubricService"/>/<see cref="IEnrollmentService"/> the REST
/// endpoints use, deriving caller identity from the gRPC call's JWT the same way the REST endpoints derive it
/// from <see cref="System.Security.Claims.ClaimsPrincipal"/>, so authorization/filtering behavior stays identical
/// to the REST path this replaces on the client side.</summary>
[Authorize]
public sealed class CatalogGrpcService(
    IAssignmentService assignmentService,
    IRubricService rubricService,
    IEnrollmentService enrollmentService) : Catalog.CatalogBase
{
    public override async Task<AssignmentReply> GetAssignment(GetAssignmentRequest request, ServerCallContext context)
    {
        var assignmentId = Guid.Parse(request.AssignmentId);
        var assignment = await assignmentService.GetByIdAsync(assignmentId, context.CancellationToken);

        if (assignment is null)
        {
            throw new RpcException(new Status(StatusCode.NotFound, $"Assignment '{assignmentId}' was not found."));
        }

        return ToReply(assignment);
    }

    public override async Task<GetCriteriaForAssignmentReply> GetCriteriaForAssignment(
        GetCriteriaForAssignmentRequest request, ServerCallContext context)
    {
        var assignmentId = Guid.Parse(request.AssignmentId);
        var caller = context.GetHttpContext().User;

        var rubrics = await rubricService.ListAsync(
            subjectId: null, assignmentId, caller.GetUserId(), caller.IsInRole("admin"), context.CancellationToken);

        var reply = new GetCriteriaForAssignmentReply();
        var criteria = rubrics.FirstOrDefault()?.Criteria ?? [];
        reply.Criteria.AddRange(criteria.Select(ToReply));
        return reply;
    }

    [Authorize(Roles = "lecturer,service")]
    public override async Task<GetLecturerStudentIdsReply> GetLecturerStudentIds(
        GetLecturerStudentIdsRequest request, ServerCallContext context)
    {
        var caller = context.GetHttpContext().User;
        var subjectId = Guid.Parse(request.SubjectId);

        Guid effectiveLecturerId;
        if (caller.IsInRole("service"))
        {
            if (!Guid.TryParse(request.LecturerId, out effectiveLecturerId) || effectiveLecturerId == Guid.Empty)
            {
                throw new RpcException(new Status(
                    StatusCode.InvalidArgument, "lecturer_id is required when called by a service."));
            }
        }
        else
        {
            effectiveLecturerId = caller.GetUserId();
        }

        var studentIds = await enrollmentService.ListStudentIdsForLecturerAsync(
            effectiveLecturerId, subjectId, context.CancellationToken);

        var reply = new GetLecturerStudentIdsReply();
        reply.StudentIds.AddRange(studentIds.Select(id => id.ToString()));
        return reply;
    }

    private static AssignmentReply ToReply(Assignment assignment)
    {
        var reply = new AssignmentReply
        {
            Id = assignment.Id.ToString(),
            SubjectId = assignment.SubjectId.ToString(),
            Title = assignment.Title,
        };

        if (assignment.Description is not null)
        {
            reply.Description = assignment.Description;
        }

        return reply;
    }

    private static RubricCriterionReply ToReply(RubricCriterion criterion)
    {
        var reply = new RubricCriterionReply
        {
            Id = criterion.Id.ToString(),
            Code = criterion.Code,
            Name = criterion.Name,
            MaxScore = criterion.MaxScore.ToString(CultureInfo.InvariantCulture),
            OrderIndex = criterion.OrderIndex,
        };

        if (criterion.Description is not null)
        {
            reply.Description = criterion.Description;
        }

        return reply;
    }
}
