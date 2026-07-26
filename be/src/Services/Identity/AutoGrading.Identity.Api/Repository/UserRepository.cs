using AutoGrading.Identity.Api.Domain;
using AutoGrading.Identity.Api.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace AutoGrading.Identity.Api.Repository;

public sealed class UserRepository(IdentityDbContext db) : IUserRepository
{
    public async Task<bool> ExistsByEmailAsync(string email, CancellationToken ct) =>
        await db.Users.AnyAsync(u => u.Email == email, ct);

    public async Task<bool> ExistsByStudentCodeAsync(string normalizedStudentCode, Guid? excludeUserId, CancellationToken ct) =>
        await db.Users.AnyAsync(u =>
            u.StudentCode != null &&
            u.StudentCode.Trim().ToLower() == normalizedStudentCode &&
            (excludeUserId == null || u.Id != excludeUserId), ct);

    public async Task<bool> ClassExistsAsync(Guid classId, CancellationToken ct) =>
        await db.ClassLecturerCaches.AnyAsync(c => c.ClassId == classId, ct);

    public async Task<Guid> CreateUserAsync(User user, CancellationToken ct)
    {
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user.Id;
    }

    public async Task<User?> GetByEmailAsync(string email, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(u => u.Email == email, ct);

    public async Task<User?> GetByGoogleSubjectOrEmailAsync(string googleSubjectId, string email, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(u => u.GoogleSubjectId == googleSubjectId || u.Email == email, ct);

    public async Task LinkGoogleSubjectIdAsync(Guid userId, string googleSubjectId, CancellationToken ct)
    {
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        user.GoogleSubjectId = googleSubjectId;
        await db.SaveChangesAsync(ct);
    }

    public async Task<User?> GetByIdAsync(Guid userId, CancellationToken ct) =>
        await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);

    public async Task<List<User>> ListAsync(IReadOnlyCollection<Guid>? ids, CancellationToken ct) =>
        ids is null
            ? await db.Users.AsNoTracking().ToListAsync(ct)
            : await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).ToListAsync(ct);

    public async Task<ClassLecturerCache?> GetClassLecturerCacheByNameAsync(string className, CancellationToken ct) =>
        await db.ClassLecturerCaches.FirstOrDefaultAsync(c => c.ClassName.ToLower() == className.ToLower(), ct);

    public async Task<Dictionary<Guid, string>> ResolveClassNamesAsync(IReadOnlyCollection<Guid> classIds, CancellationToken ct) =>
        await db.ClassLecturerCaches
            .Where(c => classIds.Contains(c.ClassId))
            .ToDictionaryAsync(c => c.ClassId, c => c.ClassName, ct);

    public async Task<bool> IsClassLecturerAsync(Guid classId, Guid lecturerId, CancellationToken ct) =>
        await db.ClassLecturerCaches.AnyAsync(c => c.ClassId == classId && c.LecturerId == lecturerId, ct);

    public async Task<bool> IsGraderForStudentAsync(Guid studentId, Guid lecturerId, CancellationToken ct) =>
        await db.SubmissionGraders
            .Join(db.SubmissionStudents, g => g.SubmissionId, s => s.SubmissionId, (g, s) => new { s.StudentId, g.LecturerId })
            .AnyAsync(x => x.StudentId == studentId && x.LecturerId == lecturerId, ct);

    public async Task UpdateRosterFieldsAsync(User target, string? studentCode, Guid? classId, CancellationToken ct)
    {
        ApplyRosterFields(target, studentCode, classId);

        await db.SaveChangesAsync(ct);
    }

    public async Task BulkUpdateRosterAsync(IReadOnlyList<(User User, string? StudentCode, Guid ClassId)> updates, CancellationToken ct)
    {
        foreach (var (user, studentCode, classId) in updates)
        {
            ApplyRosterFields(user, studentCode, classId);
        }

        await db.SaveChangesAsync(ct);
    }

    private static void ApplyRosterFields(User target, string? studentCode, Guid? classId)
    {
        if (studentCode is not null)
        {
            target.StudentCode = studentCode;
        }

        if (classId is not null)
        {
            target.ClassId = classId;
        }
    }

    public async Task UpsertClassLecturerCacheAsync(Guid classId, string className, Guid lecturerId, CancellationToken ct)
    {
        var cache = await db.ClassLecturerCaches.FirstOrDefaultAsync(c => c.ClassId == classId, ct);
        if (cache is null)
        {
            cache = new ClassLecturerCache { ClassId = classId };
            db.ClassLecturerCaches.Add(cache);
        }

        cache.ClassName = className;
        cache.LecturerId = lecturerId;

        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> SubmissionStudentExistsAsync(Guid submissionId, CancellationToken ct) =>
        await db.SubmissionStudents.AnyAsync(s => s.SubmissionId == submissionId, ct);

    public async Task InsertSubmissionStudentAsync(Guid submissionId, Guid studentId, CancellationToken ct)
    {
        db.SubmissionStudents.Add(new SubmissionStudent { SubmissionId = submissionId, StudentId = studentId });
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> SubmissionGraderExistsAsync(Guid submissionId, Guid lecturerId, CancellationToken ct) =>
        await db.SubmissionGraders.AnyAsync(g => g.SubmissionId == submissionId && g.LecturerId == lecturerId, ct);

    public async Task InsertSubmissionGraderAsync(Guid submissionId, Guid lecturerId, CancellationToken ct)
    {
        db.SubmissionGraders.Add(new SubmissionGrader { SubmissionId = submissionId, LecturerId = lecturerId });
        await db.SaveChangesAsync(ct);
    }
}
