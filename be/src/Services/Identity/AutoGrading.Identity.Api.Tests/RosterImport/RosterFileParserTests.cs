using System.Text;
using AutoGrading.Identity.Api.RosterImport;

namespace AutoGrading.Identity.Api.Tests.RosterImport;

public class RosterFileParserTests
{
    private static Stream ToStream(string content) => new MemoryStream(Encoding.UTF8.GetBytes(content));

    [Fact]
    public void Parse_ValidCsv_ReturnsExpectedRows()
    {
        const string csv = "Email,StudentCode,ClassName\nalice@school.edu,SC1,ClassA\nbob@school.edu,SC2,ClassB\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Null(result.Error);
        Assert.Equal(2, result.Rows.Count);
        Assert.Equal("alice@school.edu", result.Rows[0].Email);
        Assert.Equal("SC1", result.Rows[0].StudentCode);
        Assert.Equal("ClassA", result.Rows[0].ClassName);
        Assert.Equal(2, result.Rows[0].RowNumber);
    }

    [Fact]
    public void Parse_ColumnsInDifferentOrder_MappedByHeaderName()
    {
        const string csv = "ClassName,Email,StudentCode\nClassA,alice@school.edu,SC1\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Null(result.Error);
        Assert.Single(result.Rows);
        Assert.Equal("alice@school.edu", result.Rows[0].Email);
        Assert.Equal("ClassA", result.Rows[0].ClassName);
    }

    [Fact]
    public void Parse_HeaderCaseInsensitive_StillMaps()
    {
        const string csv = "email,studentcode,classname\nalice@school.edu,SC1,ClassA\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Null(result.Error);
        Assert.Single(result.Rows);
    }

    [Fact]
    public void Parse_MissingRequiredColumn_ReturnsError()
    {
        const string csv = "Email,ClassName\nalice@school.edu,ClassA\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Empty(result.Rows);
        Assert.Contains("missing column StudentCode", result.Error);
    }

    [Fact]
    public void Parse_EmptyFile_ReturnsError()
    {
        var result = RosterFileParser.Parse(ToStream(""), "roster.csv");

        Assert.Empty(result.Rows);
        Assert.Equal("File is empty.", result.Error);
    }

    [Fact]
    public void Parse_UnsupportedExtension_ReturnsError()
    {
        var result = RosterFileParser.Parse(ToStream("whatever"), "roster.txt");

        Assert.Empty(result.Rows);
        Assert.Contains("Unsupported file type '.txt'", result.Error);
    }

    [Fact]
    public void Parse_RowWithMissingEmailAndClassName_IsSkipped()
    {
        const string csv = "Email,StudentCode,ClassName\n,SC1,\nalice@school.edu,SC2,ClassA\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Single(result.Rows);
        Assert.Equal("alice@school.edu", result.Rows[0].Email);
    }

    [Fact]
    public void Parse_MissingStudentCode_MapsToNull()
    {
        const string csv = "Email,StudentCode,ClassName\nalice@school.edu,,ClassA\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Single(result.Rows);
        Assert.Null(result.Rows[0].StudentCode);
    }

    [Fact]
    public void Parse_QuotedCsvFieldsWithEmbeddedCommaAndQuote_AreHandled()
    {
        const string csv = "Email,StudentCode,ClassName\n\"alice@school.edu\",\"SC,1\",\"Class \"\"A\"\"\"\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Single(result.Rows);
        Assert.Equal("alice@school.edu", result.Rows[0].Email);
        Assert.Equal("SC,1", result.Rows[0].StudentCode);
        Assert.Equal("Class \"A\"", result.Rows[0].ClassName);
    }

    [Fact]
    public void Parse_ExtraBlankLines_AreIgnored()
    {
        const string csv = "Email,StudentCode,ClassName\n\nalice@school.edu,SC1,ClassA\n\n";

        var result = RosterFileParser.Parse(ToStream(csv), "roster.csv");

        Assert.Null(result.Error);
        Assert.Single(result.Rows);
    }
}
