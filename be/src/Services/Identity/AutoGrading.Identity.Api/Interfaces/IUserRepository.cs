using AutoGrading.Identity.Api.Constant;
using AutoGrading.Identity.Api.Domain;

namespace AutoGrading.Identity.Api.Interfaces;

public interface IUserRepository
{
    Task<bool> ExistsByEmailAsync(string email, CancellationToken ct);

    /// <summary>Case-insensitive, trimmed lookup. <paramref name="normalizedStudentCode"/> must already be
    /// trimmed/lower-cased by the caller. Pass <paramref name="excludeUserId"/> to exclude the user being
    /// updated (so re-saving a user's own unchanged code isn't flagged as a duplicate); pass
    /// <see langword="null"/> when checking a brand-new user (e.g. registration).</summary>
    Task<bool> ExistsByStudentCodeAsync(string normalizedStudentCode, Guid? excludeUserId, CancellationToken ct);

    Task<bool> ClassExistsAsync(Guid classId, CancellationToken ct);

    Task<Guid> CreateUserAsync(User user, CancellationToken ct);

    Task<User?> GetByEmailAsync(string email, CancellationToken ct);

    Task<User?> GetByGoogleSubjectOrEmailAsync(string googleSubjectId, string email, CancellationToken ct);

    Task LinkGoogleSubjectIdAsync(Guid userId, string googleSubjectId, CancellationToken ct);

    Task<User?> GetByIdAsync(Guid userId, CancellationToken ct);

    Task<List<User>> ListAsync(IReadOnlyCollection<Guid>? ids, CancellationToken ct);

    Task<ClassLecturerCache?> GetClassLecturerCacheByNameAsync(string className, CancellationToken ct);

    Task<Dictionary<Guid, string>> ResolveClassNamesAsync(IReadOnlyCollection<Guid> classIds, CancellationToken ct);

    Task<bool> IsClassLecturerAsync(Guid classId, Guid lecturerId, CancellationToken ct);

    Task<bool> IsGraderForStudentAsync(Guid studentId, Guid lecturerId, CancellationToken ct);

    /// <summary>Throws <see cref="System.Data.DbUpdateConcurrencyException"/> on a concurrent-modification conflict.
    /// Takes the already-fetched (tracked) <paramref name="target"/> rather than a bare id, so the caller's
    /// earlier <see cref="GetByIdAsync"/> fetch (needed anyway for the not-found/authorization checks) isn't
    /// repeated as a second fetch here.</summary>
    Task UpdateRosterFieldsAsync(User target, string? studentCode, Guid? classId, CancellationToken ct);

    /// <summary>Persists all accepted rows in one <c>SaveChangesAsync</c> call — all-or-nothing, never piecemeal.
    /// Takes already-fetched (tracked) <see cref="User"/> entities rather than bare ids, so the caller's earlier
    /// per-row lookup (e.g. <see cref="GetByEmailAsync"/>) isn't repeated as a second fetch by id here.</summary>
    Task BulkUpdateRosterAsync(IReadOnlyList<(User User, string? StudentCode, Guid ClassId)> updates, CancellationToken ct);

    /// <summary>Upserts by <c>ClassId</c>. Does not itself catch a concurrent-insert race; the caller
    /// (<c>ClassLecturerAssignedHandler</c>) catches <c>DbUpdateException</c> for the primary-key-violation
    /// redelivery case, matching today's behavior exactly.</summary>
    Task UpsertClassLecturerCacheAsync(Guid classId, string className, Guid lecturerId, CancellationToken ct);

    Task<bool> SubmissionStudentExistsAsync(Guid submissionId, CancellationToken ct);

    Task InsertSubmissionStudentAsync(Guid submissionId, Guid studentId, CancellationToken ct);

    Task<bool> SubmissionGraderExistsAsync(Guid submissionId, Guid lecturerId, CancellationToken ct);

    Task InsertSubmissionGraderAsync(Guid submissionId, Guid lecturerId, CancellationToken ct);
}

/// <summary>Thrown by <c>AuthService.RegisterAsync</c> after <see cref="IUserRepository.ExistsByEmailAsync"/>
/// returns <see langword="true"/>, before calling <see cref="IUserRepository.CreateUserAsync"/> — not thrown by
/// <c>CreateUserAsync</c> itself, which performs no existence check of its own (matches today's exact
/// check-then-create pattern, including its pre-existing, out-of-scope TOCTOU race).</summary>
public sealed class UserAlreadyExistsException(string email) : Exception(IdentityConstants.EmailAlreadyRegistered)
{
    public string Email { get; } = email;
}

/// <summary>Thrown by <c>AuthService.RegisterAsync</c> after <see cref="IUserRepository.ClassExistsAsync"/>
/// returns <see langword="false"/> for a supplied class id — same placement rule as <see cref="UserAlreadyExistsException"/>.</summary>
public sealed class ClassNotFoundException(Guid classId) : Exception(IdentityConstants.ClassNotFoundOrNotSynced)
{
    public Guid ClassId { get; } = classId;
}

/// <summary>Thrown by <c>UserService.GetAsync</c>/<c>UpdateAsync</c> after <see cref="IUserRepository.GetByIdAsync"/>
/// returns <see langword="null"/>.</summary>
public sealed class UserNotFoundException(Guid userId) : Exception(IdentityConstants.UserNotFound)
{
    public Guid UserId { get; } = userId;
}

/// <summary>Thrown by <c>UserService.UpdateAsync</c>/<c>AuthService.RegisterAsync</c> after
/// <see cref="IUserRepository.ExistsByStudentCodeAsync"/> returns <see langword="true"/> for a non-blank
/// StudentCode — same placement rule as <see cref="UserAlreadyExistsException"/>.</summary>
public sealed class StudentCodeAlreadyAssignedException(string studentCode) : Exception(IdentityConstants.StudentCodeAlreadyAssigned)
{
    public string StudentCode { get; } = studentCode;
}
