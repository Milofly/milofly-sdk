using System.Net;
using System.Text;
using System.Text.Json;

namespace Milofly.Apps;

/// <summary>Region served by a store-wide installation.</summary>
public sealed record InstallRegion(long Id, string Code, string Currency, string? Domain);

/// <summary>A completed installation. Store the access token encrypted; it is shown only once.</summary>
public sealed record InstallGrant(string AccessToken, IReadOnlyList<string> Scopes, string AppKey, long StoreId, long? RegionId,
    string InstallScope, IReadOnlyList<InstallRegion>? Regions, string? StoreName, string? StoreDomain);

/// <summary>Install (consent) screen URL and code exchange.</summary>
public static class OAuthClient
{
    /// <summary>Path of the install screen in the store panel.</summary>
    public const string InstallPath = "/plugins/install/";

    /// <summary>
    /// URL that opens the install screen for a merchant. The redirect URI is not part of it: Milofly returns to
    /// the first redirect URI registered for your app with <c>?code=…&amp;state=…</c> (or <c>?error=access_denied&amp;state=…</c>).
    /// </summary>
    /// <param name="environment">Milofly endpoints.</param>
    /// <param name="appKey">Your app key.</param>
    /// <param name="clientId">Your client id.</param>
    /// <param name="state">Opaque signed value you verify on your callback (CSRF protection). Returned unchanged.</param>
    /// <param name="scopes">Scopes to request (within the registered ones); <c>null</c> = all registered scopes.</param>
    public static Uri BuildInstallUrl(MiloflyEnvironment environment, string appKey, string clientId, string state, IEnumerable<string>? scopes = null)
    {
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentException.ThrowIfNullOrEmpty(appKey);
        ArgumentException.ThrowIfNullOrEmpty(clientId);
        ArgumentException.ThrowIfNullOrEmpty(state);
        var q = new StringBuilder("?response_type=code&client_id=").Append(Uri.EscapeDataString(clientId));
        var scopeList = scopes?.ToList();
        if (scopeList is { Count: > 0 }) q.Append("&scope=").Append(Uri.EscapeDataString(string.Join(' ', scopeList)));
        q.Append("&state=").Append(Uri.EscapeDataString(state));
        return new Uri(environment.PanelOrigin, InstallPath + Uri.EscapeDataString(appKey) + q);
    }

    /// <summary>Exchanges the one-time install code for an access token (server side: needs the client secret).</summary>
    /// <exception cref="MiloflyApiException">The code or the client credentials were refused.</exception>
    public static async Task<InstallGrant> ExchangeCodeAsync(HttpClient http, MiloflyEnvironment environment, string clientId, string clientSecret,
        string code, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(environment);
        var payload = JsonSerializer.Serialize(new { clientId, clientSecret, code });
        using var res = await http.PostAsync(new Uri(environment.ApiBaseUrl, "/api/apps/oauth/token"),
            new StringContent(payload, Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw MiloflyApiException.From(res, text);

        using var doc = JsonDocument.Parse(text);
        var r = doc.RootElement;
        string? S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        long? L(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;

        var ok = r.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.True;
        var token = S("access_token");
        var appKey = S("app_key");
        var storeId = L(r, "store_id");
        var scope = S("install_scope");
        if (!ok || token is null || appKey is null || storeId is null || scope is not ("region" or "store"))
            throw new MiloflyApiException(res.StatusCode, "unexpected_response", null, "Token response is missing required fields.", text, null);

        var scopes = r.TryGetProperty("scopes", out var sc) && sc.ValueKind == JsonValueKind.Array
            ? sc.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : new List<string>();
        List<InstallRegion>? regions = null;
        if (r.TryGetProperty("regions", out var rg) && rg.ValueKind == JsonValueKind.Array)
        {
            regions = new List<InstallRegion>();
            foreach (var x in rg.EnumerateArray())
            {
                string? XS(string n) => x.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var id = L(x, "id");
                var rc = XS("code");
                var cur = XS("currency");
                if (id is null || rc is null || cur is null)
                    throw new MiloflyApiException(res.StatusCode, "unexpected_response", null, "Token response has an incomplete region entry.", text, null);
                regions.Add(new InstallRegion(id.Value, rc, cur, XS("domain")));
            }
        }

        return new InstallGrant(token, scopes, appKey, storeId.Value, L(r, "region_id"), scope, regions, S("store_name"), S("store_domain"));
    }
}
