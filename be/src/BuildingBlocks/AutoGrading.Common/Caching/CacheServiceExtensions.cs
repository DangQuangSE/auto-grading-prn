using Microsoft.Extensions.Logging;

namespace AutoGrading.Common.Caching;

public static class CacheServiceExtensions
{
    /// <summary>Cache-aside read: returns the cached value under <paramref name="key"/> if present, otherwise
    /// calls <paramref name="factory"/>, caches a non-null result with <paramref name="ttl"/>, and returns it.
    /// Every <see cref="ICacheService"/> call is wrapped so a Redis failure (unreachable, timeout) logs a warning
    /// and falls through to <paramref name="factory"/>/no-op instead of failing the caller — per FR-05, a cache
    /// hiccup must never surface as an RPC/job failure.</summary>
    public static async Task<T> GetOrSetAsync<T>(
        this ICacheService cache,
        ILogger logger,
        string key,
        TimeSpan ttl,
        Func<CancellationToken, Task<T>> factory,
        CancellationToken cancellationToken = default)
    {
        T? cached = default;
        try
        {
            cached = await cache.GetAsync<T>(key, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Cache read failed for key {CacheKey}; falling back to source.", key);
        }

        if (cached is not null)
        {
            logger.LogInformation("Cache hit for key {CacheKey}.", key);
            return cached;
        }

        logger.LogInformation("Cache miss for key {CacheKey}.", key);
        var value = await factory(cancellationToken);

        if (value is not null)
        {
            try
            {
                await cache.SetAsync(key, value, ttl, cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Cache write failed for key {CacheKey}.", key);
            }
        }

        return value;
    }

    /// <summary>Invalidation write: removes <paramref name="key"/> from the cache. The key is logged before the
    /// call so a malformed key format is visible even when <see cref="ICacheService.RemoveAsync"/> doesn't throw;
    /// the call itself is wrapped so a Redis failure (unreachable, timeout) logs a warning and is swallowed —
    /// per FR-05, a cache hiccup must never fail a repository write that already committed successfully.</summary>
    public static async Task InvalidateAsync(
        this ICacheService cache,
        ILogger logger,
        string key,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Invalidating cache key {CacheKey}.", key);
        try
        {
            await cache.RemoveAsync(key, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Cache invalidation failed for key {CacheKey}.", key);
        }
    }
}
