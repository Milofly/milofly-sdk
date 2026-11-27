using System.Text;
using System.Text.Json;

namespace Milofly.Apps;

/// <summary>Why a session token was rejected. Treat the request as unauthenticated.</summary>
public enum SessionTokenError
{
    /// <summary>Not a Milofly session token.</summary>
    Malformed,
    /// <summary>The token's <c>Kid</c> does not belong to the secret that verified it.</summary>
    UnknownKey,
    /// <summary>The signature does not match any configured secret.</summary>
    SignatureMismatch,
    /// <summary>Token format version is not 1.</summary>
    UnsupportedVersion,
    /// <summary>The token was issued for another app.</summary>
    AppMismatch,
    /// <summary>The token expired.</summary>
    Expired,
    /// <summary>The token was issued in the future (beyond the clock skew).</summary>
    NotYetValid,
    /// <summary>The token was issued to another host origin than the one your frame talked to.</summary>
    HostOriginMismatch,
}

/// <summary>Thrown by <see cref="SessionTokenVerifier"/>.</summary>
public sealed class SessionTokenException(SessionTokenError error, string? message = null) : Exception(message ?? error.ToString())
{
    /// <summary>Stable reason.</summary>
    public SessionTokenError Error { get; } = error;
}

/// <summary>Claims of a verified session token.</summary>
/// <param name="AppKey">Your app key.</param>
/// <param name="StoreId">Store the merchant is working in.</param>
/// <param name="RegionId">Region the panel is on.</param>
/// <param name="StoreCode">Store code.</param>
/// <param name="Scope"><c>region</c> or <c>store</c> (installation scope).</param>
/// <param name="IssuedAt">Issue time.</param>
/// <param name="ExpiresAt">Expiry time.</param>
/// <param name="UserId">Panel user (identity id) viewing the app. Newer tokens only.</param>
/// <param name="TokenId">Unique token id. Newer tokens only.</param>
/// <param name="HostOrigin">Panel origin the token was issued to. Newer tokens only.</param>
/// <param name="Surface">Panel surface (<c>fullpage</c>, <c>order-detail</c>, …). Newer tokens only.</param>
/// <param name="KeyId">Id of the signing secret. Newer tokens only.</param>
public sealed record SessionTokenClaims(string AppKey, long StoreId, long? RegionId, string? StoreCode, string Scope,
    DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt, long? UserId, string? TokenId, string? HostOrigin, string? Surface, string? KeyId);

/// <summary>
/// Verifies the session token your embedded page receives from App Bridge:
/// <c>base64url(claims).hex(HMAC-SHA256(secret, "milofly-embed-v1\n" + body))</c>. The signature is checked
/// before the body is parsed.
/// </summary>
public static class SessionTokenVerifier
{
    /// <summary>Signed-string prefix; keeps session tokens and webhook signatures apart.</summary>
    public const string Domain = "milofly-embed-v1";

    /// <summary>Tolerance for tokens issued slightly in the future.</summary>
    public static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(60);

    /// <summary>Verifies <paramref name="token"/>. <paramref name="hostOrigin"/>: the origin your frame talked to (optional, recommended).</summary>
    /// <exception cref="SessionTokenException">The token is not valid for this app.</exception>
    public static SessionTokenClaims Verify(string token, IEnumerable<string> secrets, string appKey, string? hostOrigin = null,
        DateTimeOffset? now = null)
    {
        var list = Hmac.NormalizeSecrets(secrets);
        ArgumentException.ThrowIfNullOrEmpty(appKey);
        if (string.IsNullOrEmpty(token)) throw new SessionTokenException(SessionTokenError.Malformed);
        var dot = token.IndexOf('.');
        if (dot <= 0 || dot != token.LastIndexOf('.') || dot == token.Length - 1) throw new SessionTokenException(SessionTokenError.Malformed);
        var body = token[..dot];
        var signature = token[(dot + 1)..];

        var signed = Encoding.UTF8.GetBytes($"{Domain}\n{body}");
        var signer = list.FirstOrDefault(s => Hmac.VerifyHex(s, signed, signature))
            ?? throw new SessionTokenException(SessionTokenError.SignatureMismatch);

        JsonElement c;
        try
        {
            using var doc = JsonDocument.Parse(Base64UrlDecode(body));
            c = doc.RootElement.Clone();
        }
        catch (Exception e) when (e is FormatException or JsonException) { throw new SessionTokenException(SessionTokenError.Malformed); }
        if (c.ValueKind != JsonValueKind.Object) throw new SessionTokenException(SessionTokenError.Malformed);

        var kid = Str(c, "Kid");
        if (kid is not null && kid != SigningKeyId.From(signer)) throw new SessionTokenException(SessionTokenError.UnknownKey);
        if (Int(c, "V") != 1) throw new SessionTokenException(SessionTokenError.UnsupportedVersion);

        var key = Str(c, "AppKey");
        var storeId = Int(c, "StoreId");
        var iat = Int(c, "Iat");
        var exp = Int(c, "Exp");
        var scope = Str(c, "Scope");
        if (key is null || storeId is null or <= 0 || iat is null || exp is null || scope is not ("region" or "store"))
            throw new SessionTokenException(SessionTokenError.Malformed);
        if (key != appKey) throw new SessionTokenException(SessionTokenError.AppMismatch);

        var nowUnix = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        if (nowUnix > exp) throw new SessionTokenException(SessionTokenError.Expired);
        if (iat > nowUnix + (long)ClockSkew.TotalSeconds) throw new SessionTokenException(SessionTokenError.NotYetValid);

        var origin = Str(c, "HostOrigin");
        if (hostOrigin is not null && origin != hostOrigin) throw new SessionTokenException(SessionTokenError.HostOriginMismatch);

        return new SessionTokenClaims(key, storeId.Value, Int(c, "RegionId"), Str(c, "StoreCode"), scope,
            DateTimeOffset.FromUnixTimeSeconds(iat.Value), DateTimeOffset.FromUnixTimeSeconds(exp.Value),
            Int(c, "Sub"), Str(c, "Jti"), origin, Str(c, "Surface"), kid);
    }

    /// <summary>Verifies with a single secret.</summary>
    public static SessionTokenClaims Verify(string token, string secret, string appKey, string? hostOrigin = null, DateTimeOffset? now = null) =>
        Verify(token, [secret], appKey, hostOrigin, now);

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;

    private static long? Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;

    private static byte[] Base64UrlDecode(string s)
    {
        foreach (var ch in s)
            if (!(char.IsAsciiLetterOrDigit(ch) || ch == '-' || ch == '_')) throw new FormatException("not base64url");
        var t = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(t.PadRight(t.Length + (4 - t.Length % 4) % 4, '='));
    }
}
