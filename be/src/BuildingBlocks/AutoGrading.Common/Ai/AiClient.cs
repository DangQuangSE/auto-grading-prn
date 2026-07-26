using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AutoGrading.Common.Ai;

public record GradingCriterionInput(Guid RubricCriterionId, string Name, decimal MaxScore);

public record GradingCriterionResult(
    Guid RubricCriterionId,
    decimal MaxScore,
    decimal SuggestedScore,
    string? Deductions,
    string? Evidence,
    string? Comment,
    decimal? Confidence);

public record ExtractedRubricCriterion(string Name, string? Description, decimal MaxScore, int Order);

public interface IAiClient
{
    Task<IReadOnlyList<GradingCriterionResult>> GradeAsync(
        string reportContent,
        string diagramContent,
        IReadOnlyList<GradingCriterionInput> criteria,
        string? assignmentDescription,
        IReadOnlyList<string>? images,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ExtractedRubricCriterion>> ParseRubricCriteriaAsync(
        string documentText,
        CancellationToken cancellationToken);
}

public partial class AiClient(HttpClient httpClient, IOptions<AiOptions> options, ILogger<AiClient> logger) : IAiClient
{
    private readonly AiOptions _options = options.Value;

    public async Task<IReadOnlyList<GradingCriterionResult>> GradeAsync(
        string reportContent,
        string diagramContent,
        IReadOnlyList<GradingCriterionInput> criteria,
        string? assignmentDescription,
        IReadOnlyList<string>? images,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            logger.LogWarning("AI API key is not configured; using stub grading.");
            return StubGrade(criteria, "Stub grading (no AI API key configured).");
        }

        var prompt = BuildPrompt(reportContent, diagramContent, criteria, assignmentDescription);
        var userContent = _options.EnableVision
            ? BuildUserContentWithImages(prompt, images)
            : prompt;

        var requestBody = new
        {
            model = _options.Model,
            max_tokens = _options.MaxCompletionTokens,
            messages = new object[]
            {
                new { role = "system", content = "You are an assistant that grades student submissions against rubric criteria and returns strict JSON." },
                new { role = "user", content = userContent },
            },
        };

        const int maxRetries = 3;
        HttpResponseMessage? response = null;
        string payload = string.Empty;

        for (var attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/chat/completions")
                {
                    Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _options.ApiKey);

                response?.Dispose();
                response = await httpClient.SendAsync(request, cancellationToken);
                payload = await response.Content.ReadAsStringAsync(cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    break;
                }

                logger.LogWarning(
                    "AI request attempt {Attempt}/{MaxRetries} failed with {StatusCode}: {Body}",
                    attempt,
                    maxRetries,
                    response.StatusCode,
                    payload);

                if (attempt < maxRetries)
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), cancellationToken);
                }
            }
            catch (Exception ex) when (attempt < maxRetries && ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "AI request attempt {Attempt}/{MaxRetries} threw exception", attempt, maxRetries);
                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), cancellationToken);
            }
        }

        if (response is null || !response.IsSuccessStatusCode)
        {
            var statusCode = response is null ? "Exception" : ((int)response.StatusCode).ToString();
            logger.LogError("AI request failed after {MaxRetries} attempts with {StatusCode}: {Body}", maxRetries, statusCode, payload);
            return StubGrade(criteria, $"Stub grading (AI request failed after {maxRetries} attempts: {statusCode}).");
        }

        var parsed = TryParseResponse(payload, criteria, out var failureReason);
        if (parsed is not null)
        {
            return parsed;
        }

        logger.LogError("Failed to parse AI response: {Reason}. Raw payload: {Payload}", failureReason, payload);
        return StubGrade(criteria, $"Stub grading (could not parse AI response: {failureReason}).");
    }

    public async Task<IReadOnlyList<ExtractedRubricCriterion>> ParseRubricCriteriaAsync(
        string documentText,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            return StubRubricCriteria("Stub criterion (no AI API key configured).");
        }

        var prompt = BuildRubricExtractionPrompt(documentText);
        var payload = await SendChatCompletionAsync(prompt, cancellationToken);
        var parsed = TryParseRubricCriteriaResponse(payload);

        if (parsed is not null)
        {
            return parsed;
        }

        logger.LogWarning(
            "AiClient: rubric-criteria extraction response could not be parsed into valid criteria; falling back to stub. Response length: {PayloadLength}",
            payload.Length);

        return StubRubricCriteria("AI extraction could not parse a valid response for this document; add criteria manually.");
    }

    private async Task<string> SendChatCompletionAsync(string prompt, CancellationToken cancellationToken)
    {
        var requestBody = new
        {
            model = _options.Model,
            messages = new[]
            {
                new { role = "system", content = "You are an assistant that returns strict JSON and nothing else." },
                new { role = "user", content = prompt },
            },
        };

        const int maxRetries = 3;
        for (var attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/chat/completions")
                {
                    Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _options.ApiKey);

                using var response = await httpClient.SendAsync(request, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    return await response.Content.ReadAsStringAsync(cancellationToken);
                }

                if (attempt == maxRetries)
                {
                    response.EnsureSuccessStatusCode();
                }

                logger.LogWarning("SendChatCompletionAsync attempt {Attempt}/{MaxRetries} failed with {StatusCode}", attempt, maxRetries, response.StatusCode);
                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), cancellationToken);
            }
            catch (Exception ex) when (attempt < maxRetries && ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "SendChatCompletionAsync attempt {Attempt}/{MaxRetries} threw exception", attempt, maxRetries);
                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), cancellationToken);
            }
        }

        throw new HttpRequestException("AI request failed after 3 retries.");
    }

    private static object BuildUserContentWithImages(string prompt, IReadOnlyList<string>? images)
    {
        if (images is null or { Count: 0 })
        {
            return prompt;
        }

        var parts = new List<object> { new { type = "text", text = prompt } };
        parts.AddRange(images.Select(url => (object)new { type = "image_url", image_url = new { url } }));
        return parts;
    }

    private static string BuildPrompt(string reportContent, string diagramContent, IReadOnlyList<GradingCriterionInput> criteria, string? assignmentDescription)
    {
        var criteriaText = string.Join(
            "\n",
            criteria.Select(c => $"- {c.RubricCriterionId}: {c.Name} (max {c.MaxScore})"));

        var assignmentSection = string.IsNullOrWhiteSpace(assignmentDescription)
            ? string.Empty
            : $"\nAssignment description (mã đề):\n{assignmentDescription}\n";

        return $"""
                Grade the following submission against the rubric criteria below.
                Any images attached after this message are diagrams/screenshots embedded directly
                in the student's report document (e.g. UML class/sequence/activity diagrams) — inspect
                them visually and factor them into the score alongside the text content.
                Respond with a JSON array, one object per criterion, each with fields:
                rubricCriterionId, suggestedScore, deductions, evidence, comment, confidence (0-1).
                rubricCriterionId must be copied exactly as given below (a GUID string).
                {assignmentSection}
                Rubric criteria:
                {criteriaText}

                Report content:
                {reportContent}

                Diagram content:
                {(string.IsNullOrWhiteSpace(diagramContent) ? "(no diagram submitted)" : diagramContent)}
                """;
    }

    private static string BuildRubricExtractionPrompt(string documentText)
    {
        return $"""
                Extract the grading criteria from the rubric document below.
                Respond with a JSON array, one object per criterion, each with fields:
                name (string), description (string, may be empty), maxScore (number), order (integer, 0-based).

                Rubric document:
                {documentText}
                """;
    }

    private static IReadOnlyList<GradingCriterionResult>? TryParseResponse(string payload, IReadOnlyList<GradingCriterionInput> criteria, out string failureReason)
    {
        try
        {
            payload = StripStreamingSuffix(payload);
            using var doc = JsonDocument.Parse(payload);
            var contentElement = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content");

            var content = contentElement.ValueKind == JsonValueKind.String
                ? contentElement.GetString()
                : contentElement.GetRawText();

            if (string.IsNullOrWhiteSpace(content))
            {
                failureReason = "empty message content";
                return null;
            }

            var jsonText = ExtractJsonArray(content);

            using var contentDoc = JsonDocument.Parse(jsonText);
            var results = new List<GradingCriterionResult>();
            var skipped = 0;

            foreach (var item in contentDoc.RootElement.EnumerateArray())
            {
                if (!TryResolveCriterion(item, criteria, out var criterionId, out var criterion))
                {
                    skipped++;
                    continue;
                }

                results.Add(new GradingCriterionResult(
                    criterionId,
                    criterion.MaxScore,
                    GetFlexibleDecimal(item, "suggestedScore") ?? 0m,
                    GetFlexibleString(item, "deductions"),
                    GetFlexibleString(item, "evidence"),
                    GetFlexibleString(item, "comment"),
                    GetFlexibleDecimal(item, "confidence")));
            }

            if (results.Count == 0)
            {
                failureReason = $"no matching rubric criteria in AI response (skipped {skipped} item(s))";
                return null;
            }

            var coveredIds = results.Select(r => r.RubricCriterionId).ToHashSet();
            foreach (var criterion in criteria)
            {
                if (!coveredIds.Contains(criterion.RubricCriterionId))
                {
                    results.Add(new GradingCriterionResult(
                        criterion.RubricCriterionId,
                        criterion.MaxScore,
                        SuggestedScore: 0m,
                        Deductions: "Criterion omitted in AI response",
                        Evidence: "The AI model response omitted evaluation for this rubric criterion.",
                        Comment: "Criterion omitted by AI model response; fallback score assigned.",
                        Confidence: 0.5m));
                }
            }

            failureReason = string.Empty;
            return results;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            failureReason = ex.Message;
            return null;
        }
    }

    private static bool TryResolveCriterion(
        JsonElement item,
        IReadOnlyList<GradingCriterionInput> criteria,
        out Guid criterionId,
        out GradingCriterionInput criterion)
    {
        criterionId = Guid.Empty;
        criterion = null!;

        if (!item.TryGetProperty("rubricCriterionId", out var idElement))
        {
            return false;
        }

        if (idElement.ValueKind == JsonValueKind.String && Guid.TryParse(idElement.GetString(), out var parsedGuid))
        {
            var match = criteria.FirstOrDefault(c => c.RubricCriterionId == parsedGuid);
            if (match is null)
            {
                return false;
            }

            criterionId = parsedGuid;
            criterion = match;
            return true;
        }

        if (idElement.ValueKind == JsonValueKind.Number && idElement.TryGetInt32(out var index) && index >= 1 && index <= criteria.Count)
        {
            criterion = criteria[index - 1];
            criterionId = criterion.RubricCriterionId;
            return true;
        }

        return false;
    }

    private static decimal? GetFlexibleDecimal(JsonElement item, string propertyName)
    {
        if (!item.TryGetProperty(propertyName, out var element))
        {
            return null;
        }

        return element.ValueKind switch
        {
            JsonValueKind.Number when element.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(element.GetString(), out var parsed) => parsed,
            _ => null,
        };
    }

    private static string? GetFlexibleString(JsonElement item, string propertyName)
    {
        if (!item.TryGetProperty(propertyName, out var element))
        {
            return null;
        }

        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => element.GetRawText(),
            JsonValueKind.Null => null,
            _ => element.GetRawText(),
        };
    }

    private static string StripStreamingSuffix(string payload)
    {
        var dataIndex = payload.LastIndexOf("data: ", StringComparison.Ordinal);
        return dataIndex >= 0 ? payload[..dataIndex].TrimEnd() : payload;
    }

    private static string ExtractJsonArray(string content)
    {
        var trimmed = CodeFenceRegex().Replace(StripStreamingSuffix(content), string.Empty).Trim();

        var start = trimmed.IndexOf('[');
        var end = trimmed.LastIndexOf(']');
        return start >= 0 && end > start ? trimmed[start..(end + 1)] : trimmed;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^```(?:json)?\s*|\s*```$", System.Text.RegularExpressions.RegexOptions.Multiline)]
    private static partial System.Text.RegularExpressions.Regex CodeFenceRegex();

    internal static IReadOnlyList<ExtractedRubricCriterion>? TryParseRubricCriteriaResponse(string payload)
    {
        var order = 0;

        return TryParseJsonArray<ExtractedRubricCriterion>(payload, item =>
        {
            if (!item.TryGetProperty("name", out var nameProp) || nameProp.GetString() is not { Length: > 0 } name)
            {
                return null;
            }

            if (!item.TryGetProperty("maxScore", out var maxScoreProp) || !maxScoreProp.TryGetDecimal(out var maxScore))
            {
                return null;
            }

            var description = item.TryGetProperty("description", out var descProp) ? descProp.GetString() : null;
            var itemOrder = item.TryGetProperty("order", out var orderProp) && orderProp.TryGetInt32(out var parsedOrder)
                ? parsedOrder
                : order;

            order++;
            return new ExtractedRubricCriterion(name, description, maxScore, itemOrder);
        });
    }

    private static IReadOnlyList<T>? TryParseJsonArray<T>(string payload, Func<JsonElement, T?> itemParser)
        where T : class
    {
        try
        {
            var content = ExtractMessageContent(payload);
            if (string.IsNullOrWhiteSpace(content))
            {
                return null;
            }

            using var contentDoc = JsonDocument.Parse(StripCodeFence(content));
            var results = new List<T>();

            foreach (var item in contentDoc.RootElement.EnumerateArray())
            {
                var parsed = itemParser(item);
                if (parsed is not null)
                {
                    results.Add(parsed);
                }
            }

            return results.Count > 0 ? results : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ExtractMessageContent(string payload)
    {
        payload = StripStreamingSuffix(payload);
        using var doc = JsonDocument.Parse(payload);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
    }

    private static string StripCodeFence(string content)
    {
        var trimmed = content.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstNewline = trimmed.IndexOf('\n');
        if (firstNewline < 0)
        {
            return trimmed;
        }

        var withoutOpeningFence = trimmed[(firstNewline + 1)..];
        var closingFenceIndex = withoutOpeningFence.LastIndexOf("```", StringComparison.Ordinal);
        var end = closingFenceIndex >= 0 ? closingFenceIndex : withoutOpeningFence.Length;

        return withoutOpeningFence[..end].Trim();
    }

    private static IReadOnlyList<GradingCriterionResult> StubGrade(IReadOnlyList<GradingCriterionInput> criteria, string reason) =>
        criteria
            .Select(c => new GradingCriterionResult(
                c.RubricCriterionId,
                c.MaxScore,
                Math.Round(c.MaxScore * 0.8m, 2),
                Deductions: null,
                Evidence: reason,
                Comment: "Automatically generated stub score.",
                Confidence: 0.5m))
            .ToList();

    private static IReadOnlyList<ExtractedRubricCriterion> StubRubricCriteria(string reason) =>
        [new ExtractedRubricCriterion("Overall Quality", reason, 10m, 0)];
}
