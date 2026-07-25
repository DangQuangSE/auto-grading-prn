using System.Text;
using AutoGrading.Contracts.Enums;
using AutoGrading.Identity.Api.Domain;
using AutoGrading.Identity.Api.Interfaces;
using AutoGrading.Identity.Api.Service;

namespace AutoGrading.Identity.Api.Tests.Service;

public class UserServiceTests
{
    private static RequesterContext Admin() => new(Guid.NewGuid(), IsStudent: false, IsLecturer: false, IsAdmin: true);
    private static RequesterContext Lecturer(Guid id) => new(id, IsStudent: false, IsLecturer: true, IsAdmin: false);
    private static RequesterContext Student(Guid id) => new(id, IsStudent: true, IsLecturer: false, IsAdmin: false);

    private static Stream ToStream(string content) => new MemoryStream(Encoding.UTF8.GetBytes(content));

    [Fact]
    public async Task ListAsync_Admin_SeesAllUsersRegardlessOfClass()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        repo.Users.Add(new User { Email = "a@x.com", Role = AppRole.Student });
        repo.Users.Add(new User { Email = "b@x.com", Role = AppRole.Student });

        var result = await service.ListAsync(null, Admin(), CancellationToken.None);

        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task ListAsync_Lecturer_OnlySeesAuthorizedStudents()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var lecturerId = Guid.NewGuid();
        var classId = Guid.NewGuid();

        var authorizedStudent = new User { Email = "authorized@x.com", ClassId = classId };
        var unauthorizedStudent = new User { Email = "unauthorized@x.com" };
        repo.Users.Add(authorizedStudent);
        repo.Users.Add(unauthorizedStudent);
        repo.ClassLecturers.Add((classId, lecturerId));

        var result = await service.ListAsync(null, Lecturer(lecturerId), CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("authorized@x.com", result[0].Email);
    }

    [Fact]
    public async Task ListAsync_ResolvesClassNameForUsersWithClassId()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var classId = Guid.NewGuid();
        repo.ClassLecturerCachesByName["ClassA"] = new ClassLecturerCache { ClassId = classId, ClassName = "ClassA", LecturerId = Guid.NewGuid() };
        repo.Users.Add(new User { Email = "a@x.com", ClassId = classId });

        var result = await service.ListAsync(null, Admin(), CancellationToken.None);

        Assert.Equal("ClassA", result[0].ClassName);
    }

    [Fact]
    public async Task UpdateAsync_UnknownUser_ThrowsUserNotFound()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);

        await Assert.ThrowsAsync<UserNotFoundException>(() =>
            service.UpdateAsync(Guid.NewGuid(), "SC1", null, Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_UnknownClassId_ThrowsClassNotFound()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var user = new User { Email = "a@x.com" };
        repo.Users.Add(user);
        var unknownClassId = Guid.NewGuid();

        await Assert.ThrowsAsync<ClassNotFoundException>(() =>
            service.UpdateAsync(user.Id, "SC1", unknownClassId, Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_LecturerNotAuthorizedForTarget_ThrowsRosterAuthorization()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var user = new User { Email = "a@x.com" }; // no ClassId, no grader relationship
        repo.Users.Add(user);

        await Assert.ThrowsAsync<RosterAuthorizationException>(() =>
            service.UpdateAsync(user.Id, "SC1", null, Lecturer(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_LecturerIsGraderForStudent_IsAuthorized()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var lecturerId = Guid.NewGuid();
        var user = new User { Email = "a@x.com" };
        repo.Users.Add(user);
        repo.Graders.Add((user.Id, lecturerId));

        var result = await service.UpdateAsync(user.Id, "SC42", null, Lecturer(lecturerId), CancellationToken.None);

        Assert.Equal("SC42", result.StudentCode);
    }

    [Fact]
    public async Task UpdateAsync_ValidUpdate_PersistsAndReturnsSummary()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var user = new User { Email = "a@x.com" };
        repo.Users.Add(user);
        var classId = Guid.NewGuid();
        repo.ExistingClassIds.Add(classId);
        repo.ClassLecturerCachesByName["ClassA"] = new ClassLecturerCache { ClassId = classId, ClassName = "ClassA", LecturerId = Guid.NewGuid() };

        var result = await service.UpdateAsync(user.Id, "SC99", classId, Admin(), CancellationToken.None);

        Assert.Equal("SC99", result.StudentCode);
        Assert.Equal(classId, result.ClassId);
        Assert.Equal("ClassA", result.ClassName);
    }

    [Fact]
    public async Task BulkImportAsync_ParseError_ThrowsRosterFileParseException()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);

        await Assert.ThrowsAsync<RosterFileParseException>(() =>
            service.BulkImportAsync(ToStream("Email,ClassName\na@x.com,ClassA\n"), "roster.csv", Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task BulkImportAsync_UnknownClass_SkipsRowWithReason()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        const string csv = "Email,StudentCode,ClassName\na@x.com,SC1,UnknownClass\n";

        var result = await service.BulkImportAsync(ToStream(csv), "roster.csv", Admin(), CancellationToken.None);

        Assert.Equal(1, result.TotalRows);
        Assert.Equal(0, result.UpdatedCount);
        Assert.Equal(1, result.SkippedCount);
        Assert.Equal("unknown class", result.Details[0].Reason);
    }

    [Fact]
    public async Task BulkImportAsync_EmailNotRegistered_SkipsRowWithReason()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var classId = Guid.NewGuid();
        repo.ClassLecturerCachesByName["ClassA"] = new ClassLecturerCache { ClassId = classId, ClassName = "ClassA", LecturerId = Guid.NewGuid() };
        const string csv = "Email,StudentCode,ClassName\nunknown@x.com,SC1,ClassA\n";

        var result = await service.BulkImportAsync(ToStream(csv), "roster.csv", Admin(), CancellationToken.None);

        Assert.Equal(1, result.SkippedCount);
        Assert.Equal("email not registered", result.Details[0].Reason);
    }

    [Fact]
    public async Task BulkImportAsync_LecturerNotAuthorizedForStudent_SkipsRowWithReason()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var classId = Guid.NewGuid();
        var lecturerId = Guid.NewGuid();
        repo.ClassLecturerCachesByName["ClassA"] = new ClassLecturerCache { ClassId = classId, ClassName = "ClassA", LecturerId = Guid.NewGuid() };
        repo.Users.Add(new User { Email = "student@x.com" }); // not in the lecturer's class, not their grader
        const string csv = "Email,StudentCode,ClassName\nstudent@x.com,SC1,ClassA\n";

        var result = await service.BulkImportAsync(ToStream(csv), "roster.csv", Lecturer(lecturerId), CancellationToken.None);

        Assert.Equal(1, result.SkippedCount);
        Assert.Equal("not authorized for this student", result.Details[0].Reason);
    }

    [Fact]
    public async Task BulkImportAsync_ValidRow_UpdatesUserAndReportsSuccess()
    {
        var repo = new FakeUserRepository();
        var service = new UserService(repo);
        var classId = Guid.NewGuid();
        repo.ClassLecturerCachesByName["ClassA"] = new ClassLecturerCache { ClassId = classId, ClassName = "ClassA", LecturerId = Guid.NewGuid() };
        var user = new User { Email = "student@x.com" };
        repo.Users.Add(user);
        const string csv = "Email,StudentCode,ClassName\nStudent@X.com,SC1,ClassA\n";

        var result = await service.BulkImportAsync(ToStream(csv), "roster.csv", Admin(), CancellationToken.None);

        Assert.Equal(1, result.UpdatedCount);
        Assert.Equal(0, result.SkippedCount);
        Assert.Single(repo.BulkUpdates);
        Assert.Equal(classId, repo.BulkUpdates[0].ClassId);
        Assert.Equal("SC1", repo.BulkUpdates[0].StudentCode);
    }
}
