using System.Reflection;
using System.Security.Claims;
using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Grpc;
using AutoGrading.Catalog.Api.Repository;
using AutoGrading.Catalog.Api.Service;
using global::Grpc.Core;
using global::Grpc.Core.Testing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace AutoGrading.Catalog.Api.Tests.Grpc;

public class CatalogGrpcServiceTests
{
    private static (CatalogDbContext Db, CatalogGrpcService Service) CreateService()
    {
        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new CatalogDbContext(options);
        var cache = new FakeCacheService();

        var service = new CatalogGrpcService(
            new AssignmentService(
                new AssignmentRepository(db, cache, NullLogger<AssignmentRepository>.Instance),
                cache,
                NullLogger<AssignmentService>.Instance),
            new RubricService(
                new RubricRepository(db, cache, NullLogger<RubricRepository>.Instance),
                cache,
                NullLogger<RubricService>.Instance),
            new EnrollmentService(new EnrollmentRepository(db)));

        return (db, service);
    }

    private static ServerCallContext CreateContext(Guid userId, string role)
    {
        var identity = new ClaimsIdentity(authenticationType: "Test");
        identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, userId.ToString()));
        identity.AddClaim(new Claim(ClaimTypes.Role, role));
        var principal = new ClaimsPrincipal(identity);

        var context = TestServerCallContext.Create(
            method: "test",
            host: "localhost",
            deadline: DateTime.UtcNow.AddMinutes(1),
            requestHeaders: new Metadata(),
            cancellationToken: CancellationToken.None,
            peer: "peer",
            authContext: null,
            contextPropagationToken: null,
            writeHeadersFunc: _ => Task.CompletedTask,
            writeOptionsGetter: () => null,
            writeOptionsSetter: _ => { });
        context.UserState["__HttpContext"] = new DefaultHttpContext { User = principal };

        return context;
    }

    [Fact]
    public async Task GetAssignment_ExistingId_ReturnsMappedAssignment()
    {
        var (db, service) = CreateService();
        var subjectId = Guid.NewGuid();
        var assignment = new Assignment { SubjectId = subjectId, Title = "Assignment 1", Description = "desc", MaxAttempts = 3 };
        db.Assignments.Add(assignment);
        await db.SaveChangesAsync();

        var reply = await service.GetAssignment(
            new GetAssignmentRequest { AssignmentId = assignment.Id.ToString() },
            CreateContext(Guid.Empty, "service"));

        Assert.Equal(assignment.Id.ToString(), reply.Id);
        Assert.Equal(subjectId.ToString(), reply.SubjectId);
        Assert.Equal("Assignment 1", reply.Title);
        Assert.Equal("desc", reply.Description);
        Assert.Equal(3, reply.MaxAttempts);
    }

    [Fact]
    public async Task GetAssignment_UnknownId_ThrowsNotFound()
    {
        var (_, service) = CreateService();

        var ex = await Assert.ThrowsAsync<RpcException>(() => service.GetAssignment(
            new GetAssignmentRequest { AssignmentId = Guid.NewGuid().ToString() },
            CreateContext(Guid.Empty, "service")));

        Assert.Equal(StatusCode.NotFound, ex.StatusCode);
    }

    [Fact]
    public async Task GetCriteriaForAssignment_ServiceCallerWithOnlyDraftRubric_ReturnsEmptyCriteria()
    {
        var (db, service) = CreateService();
        var assignmentId = Guid.NewGuid();
        var rubric = new Rubric
        {
            SubjectId = Guid.NewGuid(),
            AssignmentId = assignmentId,
            Name = "Draft rubric",
            Status = RubricStatus.Draft,
            LecturerId = Guid.NewGuid(),
        };
        rubric.Criteria.Add(new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", MaxScore = 10m, OrderIndex = 0 });
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();

        var reply = await service.GetCriteriaForAssignment(
            new GetCriteriaForAssignmentRequest { AssignmentId = assignmentId.ToString() },
            CreateContext(Guid.Empty, "service"));

        Assert.Empty(reply.Criteria);
    }

    [Fact]
    public async Task GetCriteriaForAssignment_ServiceCallerWithConfirmedRubric_ReturnsCriteria()
    {
        var (db, service) = CreateService();
        var assignmentId = Guid.NewGuid();
        var rubric = new Rubric
        {
            SubjectId = Guid.NewGuid(),
            AssignmentId = assignmentId,
            Name = "Confirmed rubric",
            Status = RubricStatus.Confirmed,
            LecturerId = Guid.NewGuid(),
        };
        rubric.Criteria.Add(new RubricCriterion { RubricId = rubric.Id, Code = "C1", Name = "Criterion 1", Description = "d", MaxScore = 12.5m, OrderIndex = 0 });
        db.Rubrics.Add(rubric);
        await db.SaveChangesAsync();

        var reply = await service.GetCriteriaForAssignment(
            new GetCriteriaForAssignmentRequest { AssignmentId = assignmentId.ToString() },
            CreateContext(Guid.Empty, "service"));

        var criterion = Assert.Single(reply.Criteria);
        Assert.Equal("Criterion 1", criterion.Name);
        Assert.Equal("12.5", criterion.MaxScore);
    }

    [Fact]
    public async Task GetLecturerStudentIds_ServiceCaller_UsesRequestLecturerId()
    {
        var (db, service) = CreateService();
        var subjectId = Guid.NewGuid();
        var lecturerId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var subject = new Subject { Code = "SUB1", Name = "Subject 1" };
        var @class = new Class { Name = "Class 1", NormalizedName = "CLASS 1", LecturerId = lecturerId, SubjectId = subjectId, EnrollmentSubjectId = subjectId };
        db.Subjects.Add(subject);
        db.Classes.Add(@class);
        db.StudentEnrollments.Add(new StudentEnrollment { StudentId = studentId, SubjectId = subjectId, ClassId = @class.Id });
        await db.SaveChangesAsync();

        var reply = await service.GetLecturerStudentIds(
            new GetLecturerStudentIdsRequest { SubjectId = subjectId.ToString(), LecturerId = lecturerId.ToString() },
            CreateContext(Guid.Empty, "service"));

        var id = Assert.Single(reply.StudentIds);
        Assert.Equal(studentId.ToString(), id);
    }

    [Fact]
    public async Task GetLecturerStudentIds_ServiceCallerWithoutLecturerId_ThrowsInvalidArgument()
    {
        var (_, service) = CreateService();

        var ex = await Assert.ThrowsAsync<RpcException>(() => service.GetLecturerStudentIds(
            new GetLecturerStudentIdsRequest { SubjectId = Guid.NewGuid().ToString() },
            CreateContext(Guid.Empty, "service")));

        Assert.Equal(StatusCode.InvalidArgument, ex.StatusCode);
    }

    [Fact]
    public void CatalogGrpcService_ClassLevel_RequiresAuthorization()
    {
        var attribute = typeof(CatalogGrpcService).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(attribute);
    }

    [Fact]
    public void GetCriteriaForAssignment_IsGatedToServiceRoleOnly()
    {
        var method = typeof(CatalogGrpcService).GetMethod(
            nameof(CatalogGrpcService.GetCriteriaForAssignment),
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)!;

        var attribute = method.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal("service", attribute!.Roles);
    }

    [Fact]
    public void GetLecturerStudentIds_IsGatedToLecturerAndServiceRolesOnly()
    {
        var method = typeof(CatalogGrpcService).GetMethod(
            nameof(CatalogGrpcService.GetLecturerStudentIds),
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)!;

        var attribute = method.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal("lecturer,service", attribute!.Roles);
    }

    /// <summary>Builds a real <see cref="IAuthorizationService"/> (no HTTP host required) and evaluates the
    /// supplied <see cref="AuthorizeAttribute"/> against a principal, so role/authentication rejection is proven
    /// via ASP.NET Core's actual authorization requirements (<c>RolesAuthorizationRequirement</c>,
    /// <c>DenyAnonymousAuthorizationRequirement</c>) rather than merely asserting the attribute's declared value.</summary>
    private static async Task<bool> EvaluateAsync(AuthorizeAttribute attribute, ClaimsPrincipal principal)
    {
        var services = new ServiceCollection();
        services.AddAuthorization();
        services.AddLogging();
        await using var provider = services.BuildServiceProvider();

        var policyProvider = provider.GetRequiredService<IAuthorizationPolicyProvider>();
        var authorizationService = provider.GetRequiredService<IAuthorizationService>();
        var policy = await AuthorizationPolicy.CombineAsync(policyProvider, [attribute]);

        var result = await authorizationService.AuthorizeAsync(principal, policy!);
        return result.Succeeded;
    }

    private static ClaimsPrincipal CreatePrincipal(string? role, bool authenticated = true)
    {
        var identity = new ClaimsIdentity(authenticationType: authenticated ? "Test" : null);
        if (role is not null)
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }
        return new ClaimsPrincipal(identity);
    }

    [Fact]
    public async Task CatalogGrpcService_ClassLevel_RejectsUnauthenticatedCaller()
    {
        var attribute = typeof(CatalogGrpcService).GetCustomAttribute<AuthorizeAttribute>()!;

        var allowed = await EvaluateAsync(attribute, CreatePrincipal(role: null, authenticated: false));

        Assert.False(allowed);
    }

    [Fact]
    public async Task CatalogGrpcService_ClassLevel_AllowsAnyAuthenticatedCaller()
    {
        var attribute = typeof(CatalogGrpcService).GetCustomAttribute<AuthorizeAttribute>()!;

        var allowed = await EvaluateAsync(attribute, CreatePrincipal(role: "student"));

        Assert.True(allowed);
    }

    [Theory]
    [InlineData("student", false)]
    [InlineData("admin", false)]
    [InlineData(null, false)]
    [InlineData("lecturer", true)]
    [InlineData("service", true)]
    public async Task GetLecturerStudentIds_RoleGate_RejectsCallersWithoutLecturerOrServiceRole(string? role, bool expectedAllowed)
    {
        var method = typeof(CatalogGrpcService).GetMethod(
            nameof(CatalogGrpcService.GetLecturerStudentIds),
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)!;
        var attribute = method.GetCustomAttribute<AuthorizeAttribute>()!;

        var allowed = await EvaluateAsync(attribute, CreatePrincipal(role));

        Assert.Equal(expectedAllowed, allowed);
    }

    [Theory]
    [InlineData("student", false)]
    [InlineData("admin", false)]
    [InlineData("lecturer", false)]
    [InlineData(null, false)]
    [InlineData("service", true)]
    public async Task GetCriteriaForAssignment_RoleGate_RejectsCallersWithoutServiceRole(string? role, bool expectedAllowed)
    {
        var method = typeof(CatalogGrpcService).GetMethod(
            nameof(CatalogGrpcService.GetCriteriaForAssignment),
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)!;
        var attribute = method.GetCustomAttribute<AuthorizeAttribute>()!;

        var allowed = await EvaluateAsync(attribute, CreatePrincipal(role));

        Assert.Equal(expectedAllowed, allowed);
    }
}
