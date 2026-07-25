using AutoGrading.Identity.Api.Auth;

namespace AutoGrading.Identity.Api.Tests.Auth;

public class EducationEmailValidatorTests
{
    [Theory]
    [InlineData("student@school.edu")]
    [InlineData("student@fpt.edu.vn")]
    [InlineData("student@unimelb.edu.au")]
    [InlineData("STUDENT@SCHOOL.EDU")]
    public void IsEducationEmail_AcademicDomains_ReturnsTrue(string email)
    {
        Assert.True(EducationEmailValidator.IsEducationEmail(email));
    }

    [Theory]
    [InlineData("student@gmail.com")]
    [InlineData("student@example.com")]
    [InlineData("noatsign")]
    [InlineData("trailing@")]
    public void IsEducationEmail_NonAcademicOrMalformed_ReturnsFalse(string email)
    {
        Assert.False(EducationEmailValidator.IsEducationEmail(email));
    }
}
