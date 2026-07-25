using System.Text.Json;
using StackExchange.Redis;

namespace AutoGrading.Common.Caching;

/// <summary>Redis-backed cache-aside wrapper. Always resolves <see cref="IDatabase"/> fresh per
/// call from the injected <see cref="IConnectionMultiplexer"/> singleton rather than caching it,
/// since the multiplexer transparently reconnects and a held <see cref="IDatabase"/> reference
/// would not survive that.</summary>
public sealed class RedisCacheService(IConnectionMultiplexer multiplexer) : ICacheService
{
    public async Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
    {
        var db = multiplexer.GetDatabase();
        var value = await db.StringGetAsync(key);

        return value.IsNullOrEmpty ? default : JsonSerializer.Deserialize<T>(value!);
    }

    public async Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken cancellationToken = default)
    {
        var db = multiplexer.GetDatabase();
        await db.StringSetAsync(key, JsonSerializer.Serialize(value), ttl);
    }

    public async Task RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        var db = multiplexer.GetDatabase();
        await db.KeyDeleteAsync(key);
    }
}
