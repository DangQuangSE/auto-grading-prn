using AutoGrading.Common.Caching;

namespace AutoGrading.Catalog.Api.Tests;

/// <summary>Hand-rolled in-memory <see cref="ICacheService"/> test double (no mocking library, matching this
/// repo's test-double convention). Set <see cref="ThrowOnAccess"/> to simulate Redis being unreachable for
/// FR-05 fallback tests.</summary>
public sealed class FakeCacheService : ICacheService
{
    private readonly Dictionary<string, object?> _store = [];

    public bool ThrowOnAccess { get; set; }

    public int SetCount { get; private set; }

    public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
    {
        if (ThrowOnAccess)
        {
            throw new InvalidOperationException("Simulated Redis outage.");
        }

        return Task.FromResult(_store.TryGetValue(key, out var value) ? (T?)value : default);
    }

    public Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken cancellationToken = default)
    {
        if (ThrowOnAccess)
        {
            throw new InvalidOperationException("Simulated Redis outage.");
        }

        SetCount++;
        _store[key] = value;
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        if (ThrowOnAccess)
        {
            throw new InvalidOperationException("Simulated Redis outage.");
        }

        _store.Remove(key);
        return Task.CompletedTask;
    }
}
