using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Milofly.Apps;

/// <summary>
/// Non-success answer of the Milofly API (status outside 2xx, or <c>success: false</c>).
/// <see cref="Code"/>/<see cref="Params"/> come from the API error envelope; <see cref="Code"/> is <c>null</c> when none was sent.
/// </summary>
public sealed class MiloflyApiException(HttpStatusCode status, string? code, JsonElement? parameters, string message, string? body, TimeSpan? retryAfter)
    : Exception(message)
{
    /// <summary>HTTP status.</summary>
    public HttpStatusCode Status { get; } = status;
    /// <summary>Machine-readable error code, when the API sent one.</summary>
    public string? Code { get; } = code;
    /// <summary>Error parameters, when the API sent them.</summary>
    public JsonElement? Params { get; } = parameters;
    /// <summary>Raw response body.</summary>
    public string? Body { get; } = body;
    /// <summary><c>Retry-After</c> of a 429.</summary>
    public TimeSpan? RetryAfter { get; } = retryAfter;

    internal static MiloflyApiException From(HttpResponseMessage res, string? body)
    {
        string? code = null, message = null;
        JsonElement? prms = null;
        if (!string.IsNullOrEmpty(body))
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    if (root.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String && c.GetString() is { Length: > 0 } cs) code = cs;
                    if (root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String && m.GetString() is { Length: > 0 } ms) message = ms;
                    if (root.TryGetProperty("params", out var p) && p.ValueKind == JsonValueKind.Object) prms = p.Clone();
                }
            }
            catch (JsonException)
            {
                // Not JSON (proxy error page): the raw body is kept in Body; the message says so below.
            }
        }
        var retry = res.Headers.RetryAfter?.Delta
            ?? (res.Headers.RetryAfter?.Date is { } at ? at - DateTimeOffset.UtcNow : null);
        return new MiloflyApiException(res.StatusCode, code, prms,
            message ?? $"Milofly API responded {(int)res.StatusCode}{(code is null ? "" : $" ({code})")}.", body, retry);
    }
}

/// <summary>How a 429 is retried. <c>null</c> in <see cref="MiloflyApiClient"/>: a 429 fails at once.</summary>
/// <param name="MaxRetries">How many times a 429 is retried.</param>
/// <param name="MaxWait">Largest <c>Retry-After</c> the client waits; a longer one fails immediately.</param>
public sealed record RateLimitRetry(int MaxRetries, TimeSpan MaxWait);

/// <summary>
/// Authenticated client for <c>/api/apps/**</c>. Typed operations are generated on top of it.
/// Every non-2xx answer and every <c>success: false</c> body throws <see cref="MiloflyApiException"/>.
/// </summary>
public sealed class MiloflyApiClient
{
    private readonly HttpClient _http;
    private readonly MiloflyEnvironment _environment;
    private readonly string _accessToken;
    private readonly long? _regionId;
    private readonly RateLimitRetry? _retry;

    /// <param name="http">Your <see cref="HttpClient"/> (from <c>IHttpClientFactory</c>).</param>
    /// <param name="environment">Milofly endpoints (<see cref="MiloflyEnvironment.Production"/> or your own).</param>
    /// <param name="accessToken">Access token of the installation.</param>
    /// <param name="retry">429 policy; <c>null</c> = no retry.</param>
    /// <param name="regionId">Region used when a request does not set one (store-wide installations must pin one on most endpoints).</param>
    public MiloflyApiClient(HttpClient http, MiloflyEnvironment environment, string accessToken, RateLimitRetry? retry, long? regionId = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentException.ThrowIfNullOrEmpty(accessToken);
        _http = http;
        _environment = environment;
        _accessToken = accessToken;
        _retry = retry;
        _regionId = regionId;
    }

    /// <summary>Sends a request and returns the JSON body.</summary>
    /// <param name="method">HTTP method.</param>
    /// <param name="path">Full path, e.g. <c>/api/apps/v1/products</c>.</param>
    /// <param name="query">Query parameters (null values are skipped).</param>
    /// <param name="body">JSON body (serialized with <see cref="JsonSerializerDefaults.Web"/>).</param>
    /// <param name="regionId">Region for this request.</param>
    /// <param name="ct">Cancellation.</param>
    public async Task<JsonElement> SendAsync(HttpMethod method, string path, IReadOnlyDictionary<string, string?>? query = null,
        object? body = null, long? regionId = null, CancellationToken ct = default)
    {
        if (!path.StartsWith("/api/apps/", StringComparison.Ordinal))
            throw new ArgumentException($"path must start with /api/apps/ (got {path}).", nameof(path));
        var url = new StringBuilder(new Uri(_environment.ApiBaseUrl, path).ToString());
        if (query is not null)
        {
            var sep = '?';
            foreach (var (k, v) in query)
            {
                if (v is null) continue;
                url.Append(sep).Append(Uri.EscapeDataString(k)).Append('=').Append(Uri.EscapeDataString(v));
                sep = '&';
            }
        }
        var json = body is null ? null : JsonSerializer.Serialize(body, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var region = regionId ?? _regionId;

        for (var attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(method, url.ToString());
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _accessToken);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (region is not null) req.Headers.Add("X-Region-Id", region.Value.ToString());
            if (json is not null) req.Content = new StringContent(json, Encoding.UTF8, "application/json");

            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            if (res.StatusCode == HttpStatusCode.TooManyRequests && _retry is not null && attempt < _retry.MaxRetries
                && res.Headers.RetryAfter?.Delta is { } wait && wait <= _retry.MaxWait)
            {
                await Task.Delay(wait, ct).ConfigureAwait(false);
                continue;
            }
            if (!res.IsSuccessStatusCode) throw MiloflyApiException.From(res, text);
            if (string.IsNullOrEmpty(text)) return default;

            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement.Clone();
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.False)
                throw MiloflyApiException.From(res, text);
            return root;
        }
    }
}
