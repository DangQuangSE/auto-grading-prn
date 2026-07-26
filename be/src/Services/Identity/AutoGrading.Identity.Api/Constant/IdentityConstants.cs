namespace AutoGrading.Identity.Api.Constant;

public static class IdentityConstants
{
    public const string EmailAlreadyRegistered = "Email already registered.";
    public const string ClassNotFoundOrNotSynced = "Class not found or not yet synchronized; please try again or contact your administrator.";
    public const string UserNotFound = "User not found.";
    public const string RosterAuthorizationDenied = "Not authorized to modify this student's roster fields.";
    public const string UnknownClass = "unknown class";
    public const string EmailNotRegistered = "email not registered";
    public const string NotAuthorizedForStudent = "not authorized for this student";
    public const string ConcurrentModificationError = "User {0} was modified concurrently; reload and try again.";
    public const string StudentCodeAlreadyAssigned = "MSSV already exists.";
    public const string StudentCodeAlreadyAssignedSkipReason = "studentCode already assigned to another student";
}
