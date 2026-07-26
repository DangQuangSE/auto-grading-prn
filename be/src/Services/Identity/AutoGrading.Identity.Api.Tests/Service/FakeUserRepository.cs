using AutoGrading.Identity.Api.Domain;
using AutoGrading.Identity.Api.Interfaces;

namespace AutoGrading.Identity.Api.Tests.Service;

/// <summary>Hand-rolled in-memory fake of IUserRepository (no EF/DB involved), modeled on the Catalog
/// test suite's FakeCacheService pattern — just enough behavior to drive UserService/AuthService.</summary>
public sealed class FakeUserRepository : IUserRepository
{
    public readonly List<User> Users = [];
    public readonly HashSet<Guid> ExistingClassIds = [];
    public readonly Dictionary<string, ClassLecturerCache> ClassLecturerCachesByName = new(StringComparer.OrdinalIgnoreCase);
    public readonly HashSet<(Guid ClassId, Guid LecturerId)> ClassLecturers = [];
    public readonly HashSet<(Guid StudentId, Guid LecturerId)> Graders = [];
    public readonly List<(User User, string? StudentCode, Guid ClassId)> BulkUpdates = [];
    public (User Target, string? StudentCode, Guid? ClassId)? LastRosterFieldsUpdate;

    public Task<bool> ExistsByEmailAsync(string email, CancellationToken ct) =>
        Task.FromResult(Users.Any(u => u.Email == email));

    public Task<bool> ExistsByStudentCodeAsync(string normalizedStudentCode, Guid? excludeUserId, CancellationToken ct) =>
        Task.FromResult(Users.Any(u =>
            u.StudentCode != null &&
            u.StudentCode.Trim().ToLowerInvariant() == normalizedStudentCode &&
            (excludeUserId == null || u.Id != excludeUserId)));

    public Task<bool> ClassExistsAsync(Guid classId, CancellationToken ct) =>
        Task.FromResult(ExistingClassIds.Contains(classId));

    public Task<Guid> CreateUserAsync(User user, CancellationToken ct)
    {
        Users.Add(user);
        return Task.FromResult(user.Id);
    }

    public Task<User?> GetByEmailAsync(string email, CancellationToken ct) =>
        Task.FromResult(Users.SingleOrDefault(u => u.Email == email));

    public Task<User?> GetByGoogleSubjectOrEmailAsync(string googleSubjectId, string email, CancellationToken ct) =>
        Task.FromResult(Users.SingleOrDefault(u => u.GoogleSubjectId == googleSubjectId || u.Email == email));

    public Task LinkGoogleSubjectIdAsync(Guid userId, string googleSubjectId, CancellationToken ct)
    {
        Users.Single(u => u.Id == userId).GoogleSubjectId = googleSubjectId;
        return Task.CompletedTask;
    }

    public Task<User?> GetByIdAsync(Guid userId, CancellationToken ct) =>
        Task.FromResult(Users.SingleOrDefault(u => u.Id == userId));

    public Task<List<User>> ListAsync(IReadOnlyCollection<Guid>? ids, CancellationToken ct)
    {
        IEnumerable<User> query = Users;
        if (ids is not null) query = query.Where(u => ids.Contains(u.Id));
        return Task.FromResult(query.ToList());
    }

    public Task<ClassLecturerCache?> GetClassLecturerCacheByNameAsync(string className, CancellationToken ct) =>
        Task.FromResult(ClassLecturerCachesByName.GetValueOrDefault(className));

    public Task<Dictionary<Guid, string>> ResolveClassNamesAsync(IReadOnlyCollection<Guid> classIds, CancellationToken ct) =>
        Task.FromResult(ClassLecturerCachesByName.Values
            .Where(c => classIds.Contains(c.ClassId))
            .ToDictionary(c => c.ClassId, c => c.ClassName));

    public Task<bool> IsClassLecturerAsync(Guid classId, Guid lecturerId, CancellationToken ct) =>
        Task.FromResult(ClassLecturers.Contains((classId, lecturerId)));

    public Task<bool> IsGraderForStudentAsync(Guid studentId, Guid lecturerId, CancellationToken ct) =>
        Task.FromResult(Graders.Contains((studentId, lecturerId)));

    public Task UpdateRosterFieldsAsync(User target, string? studentCode, Guid? classId, CancellationToken ct)
    {
        target.StudentCode = studentCode;
        target.ClassId = classId;
        LastRosterFieldsUpdate = (target, studentCode, classId);
        return Task.CompletedTask;
    }

    public Task BulkUpdateRosterAsync(IReadOnlyList<(User User, string? StudentCode, Guid ClassId)> updates, CancellationToken ct)
    {
        foreach (var (user, studentCode, classId) in updates)
        {
            user.StudentCode = studentCode;
            user.ClassId = classId;
        }

        BulkUpdates.AddRange(updates);
        return Task.CompletedTask;
    }

    public Task UpsertClassLecturerCacheAsync(Guid classId, string className, Guid lecturerId, CancellationToken ct)
    {
        ClassLecturerCachesByName[className] = new ClassLecturerCache { ClassId = classId, ClassName = className, LecturerId = lecturerId };
        return Task.CompletedTask;
    }

    public Task<bool> SubmissionStudentExistsAsync(Guid submissionId, CancellationToken ct) => Task.FromResult(false);

    public Task InsertSubmissionStudentAsync(Guid submissionId, Guid studentId, CancellationToken ct) => Task.CompletedTask;

    public Task<bool> SubmissionGraderExistsAsync(Guid submissionId, Guid lecturerId, CancellationToken ct) => Task.FromResult(false);

    public Task InsertSubmissionGraderAsync(Guid submissionId, Guid lecturerId, CancellationToken ct) => Task.CompletedTask;
}
