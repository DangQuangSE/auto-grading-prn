using AutoGrading.Common.Auth;
using AutoGrading.Common.Caching;
using AutoGrading.Common.Messaging;
using AutoGrading.Common.Ai;
using AutoGrading.Common.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

namespace AutoGrading.Common.Extensions;

public static class ServiceCollectionExtensions
{
    /// <summary>Registers the RabbitMQ-backed <see cref="IEventBus"/> as a singleton, bound to the "RabbitMq" config section.</summary>
    public static IServiceCollection AddEventBus(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RabbitMqOptions>(configuration.GetSection(RabbitMqOptions.SectionName));
        services.AddSingleton<IEventBus, RabbitMqEventBus>();

        return services;
    }

    /// <summary>Registers the MinIO-backed <see cref="IObjectStorage"/>, bound to the "Minio" config section.</summary>
    public static IServiceCollection AddObjectStorage(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<MinioOptions>(configuration.GetSection(MinioOptions.SectionName));
        services.AddSingleton<IObjectStorage, MinioStorage>();

        return services;
    }

    /// <summary>Registers the JWT token generator used by the Identity Service to issue tokens.</summary>
    public static IServiceCollection AddJwtTokenGenerator(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.AddSingleton<JwtTokenGenerator>();

        return services;
    }

    /// <summary>Registers the shared AI client, bound to the "Ai" config section.</summary>
    public static IServiceCollection AddAiClient(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.SectionName));
        services.AddHttpClient<IAiClient, AiClient>();

        return services;
    }

    /// <summary>Registers the Redis-backed <see cref="ICacheService"/>, bound to the "Redis" config section.
    /// <c>AbortOnConnectFail = false</c> so the host can still start even if Redis is unreachable at boot —
    /// callers must treat cache operations as best-effort, never a hard dependency.</summary>
    public static IServiceCollection AddCacheService(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RedisCacheOptions>(configuration.GetSection(RedisCacheOptions.SectionName));

        services.AddSingleton<IConnectionMultiplexer>(sp =>
        {
            var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<RedisCacheOptions>>().Value;
            var configurationOptions = ConfigurationOptions.Parse(options.ConnectionString);
            configurationOptions.AbortOnConnectFail = false;

            return ConnectionMultiplexer.Connect(configurationOptions);
        });
        services.AddSingleton<ICacheService, RedisCacheService>();

        return services;
    }
}
