namespace AutoGrading.Common.Ai;

public class AiOptions
{
    public const string SectionName = "Ai";

    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "PRN";
    public string BaseUrl { get; set; } = "https://9routerhelios.duckdns.org/v1";

    public int MaxCompletionTokens { get; set; } = 16000;
    public bool EnableVision { get; set; } = true;
}
