using AutoGrading.Identity.Api.Constant;
using AutoGrading.Identity.Api.Domain;
using AutoGrading.Identity.Api.Interfaces;
using AutoGrading.Identity.Api.RosterImport;

namespace AutoGrading.Identity.Api.Service;

public sealed class UserService(IUserRepository repository) : IUserService
{
    public async Task<List<UserSummaryData>> ListAsync(IReadOnlyCollection<Guid>? ids, RequesterContext requester, CancellationToken ct)
    {
        var users = await repository.ListAsync(ids, ct);

        if (!requester.IsAdmin)
        {
            var authorized = new List<User>();
            foreach (var user in users)
            {
                var authorization = await AuthorizeRosterAccessAsync(requester, user, ct);
                if (authorization != RosterAuthorizationResult.Denied)
                {
                    authorized.Add(user);
                }
            }
            users = authorized;
        }

        return await ResolveClassNamesAsync(users, ct);
    }

    public async Task<UserSummaryData> UpdateAsync(Guid userId, string? studentCode, Guid? classId, RequesterContext requester, CancellationToken ct)
    {
        var target = await repository.GetByIdAsync(userId, ct) ?? throw new UserNotFoundException(userId);

        var authorization = await AuthorizeRosterAccessAsync(requester, target, ct);
        if (authorization == RosterAuthorizationResult.Denied)
        {
            throw new RosterAuthorizationException();
        }

        if (classId is { } id && !await repository.ClassExistsAsync(id, ct))
        {
            throw new ClassNotFoundException(id);
        }

        if (!string.IsNullOrWhiteSpace(studentCode) &&
            await repository.ExistsByStudentCodeAsync(studentCode.Trim().ToLowerInvariant(), target.Id, ct))
        {
            throw new StudentCodeAlreadyAssignedException(studentCode.Trim());
        }

        await repository.UpdateRosterFieldsAsync(target, studentCode, classId, ct);

        return (await ResolveClassNamesAsync([target], ct)).Single();
    }

    /// <summary>Only reads from <paramref name="fileStream"/> — never disposes it; the endpoint owns
    /// the stream's lifetime via its own <c>await using</c> block.</summary>
    public async Task<RosterImportResult> BulkImportAsync(Stream fileStream, string fileName, RequesterContext requester, CancellationToken ct)
    {
        var parseResult = RosterFileParser.Parse(fileStream, fileName);
        if (parseResult.Error is not null)
        {
            throw new RosterFileParseException(parseResult.Error);
        }

        var details = new List<RosterImportRowOutcome>();
        var accepted = new List<(User User, string? StudentCode, Guid ClassId)>();
        var updatedCount = 0;
        // Tracks normalized (trimmed, lower-cased) StudentCodes already accepted earlier in this same
        // file, keyed to the accepting user — catches duplicates within the batch itself, since rows
        // aren't persisted (and thus aren't visible to ExistsByStudentCodeAsync) until the single
        // BulkUpdateRosterAsync call at the end.
        var acceptedStudentCodes = new Dictionary<string, Guid>();

        foreach (var row in parseResult.Rows)
        {
            var email = row.Email.Trim().ToLowerInvariant();
            var className = row.ClassName.Trim();

            var classCache = await repository.GetClassLecturerCacheByNameAsync(className, ct);
            if (classCache is null)
            {
                details.Add(new RosterImportRowOutcome(row.RowNumber, email, "skipped", "unknown class"));
                continue;
            }

            var user = await repository.GetByEmailAsync(email, ct);
            if (user is null)
            {
                details.Add(new RosterImportRowOutcome(row.RowNumber, email, "skipped", "email not registered"));
                continue;
            }

            var authorization = await AuthorizeRosterAccessAsync(requester, user, ct);
            if (authorization == RosterAuthorizationResult.Denied)
            {
                details.Add(new RosterImportRowOutcome(row.RowNumber, email, "skipped", "not authorized for this student"));
                continue;
            }

            if (!string.IsNullOrWhiteSpace(row.StudentCode))
            {
                var normalizedStudentCode = row.StudentCode.Trim().ToLowerInvariant();
                var duplicate = (acceptedStudentCodes.TryGetValue(normalizedStudentCode, out var owner) && owner != user.Id) ||
                    await repository.ExistsByStudentCodeAsync(normalizedStudentCode, user.Id, ct);
                if (duplicate)
                {
                    details.Add(new RosterImportRowOutcome(row.RowNumber, email, "skipped", IdentityConstants.StudentCodeAlreadyAssignedSkipReason));
                    continue;
                }

                acceptedStudentCodes[normalizedStudentCode] = user.Id;
            }

            accepted.Add((user, row.StudentCode, classCache.ClassId));
            details.Add(new RosterImportRowOutcome(row.RowNumber, email, "updated", null));
            updatedCount++;
        }

        // Exactly one call — repository.BulkUpdateRosterAsync owns the single SaveChangesAsync for all accepted rows.
        await repository.BulkUpdateRosterAsync(accepted, ct);

        return new RosterImportResult(parseResult.Rows.Count, updatedCount, parseResult.Rows.Count - updatedCount, details);
    }

    /// <summary>Determines whether <paramref name="requester"/> may read/modify <paramref name="target"/>'s
    /// roster fields — admin always allowed, lecturer allowed if they teach the student's class or have
    /// graded one of their submissions, otherwise denied. Replaces the retired static
    /// <c>RosterAuthorization.AuthorizeAsync</c> helper; this is the one canonical location for this logic.</summary>
    private async Task<RosterAuthorizationResult> AuthorizeRosterAccessAsync(RequesterContext requester, User target, CancellationToken ct)
    {
        if (requester.IsAdmin)
        {
            return RosterAuthorizationResult.Admin;
        }

        if (!requester.IsLecturer)
        {
            return RosterAuthorizationResult.Denied;
        }

        var lecturerId = requester.UserId!.Value;

        if (target.ClassId is { } classId)
        {
            var isClassLecturer = await repository.IsClassLecturerAsync(classId, lecturerId, ct);
            if (isClassLecturer)
            {
                return RosterAuthorizationResult.ClassLecturer;
            }
        }

        var isGrader = await repository.IsGraderForStudentAsync(target.Id, lecturerId, ct);
        return isGrader ? RosterAuthorizationResult.Grader : RosterAuthorizationResult.Denied;
    }

    private async Task<List<UserSummaryData>> ResolveClassNamesAsync(List<User> users, CancellationToken ct)
    {
        var classIds = users.Where(u => u.ClassId is not null).Select(u => u.ClassId!.Value).Distinct().ToList();
        var classNames = await repository.ResolveClassNamesAsync(classIds, ct);

        return users
            .Select(u => new UserSummaryData(
                u.Id,
                u.Email,
                u.FullName,
                u.Role.ToString().ToLowerInvariant(),
                u.StudentCode,
                u.ClassId,
                u.ClassId is { } classId && classNames.TryGetValue(classId, out var className) ? className : null))
            .ToList();
    }
}
