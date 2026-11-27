using System.Text;
using System.Text.Json;

namespace Milofly.Apps;

/// <summary>Why a webhook delivery was rejected. Answer with 401 and do not process it.</summary>
public enum WebhookVerificationError
{
    /// <summary>A required <c>X-Milofly-*</c> header is missing.</summary>
    MissingHeader,
    /// <summary>Store or timestamp header is not an integer.</summary>
    MalformedHeader,
    /// <summary>Timestamp outside the replay window.</summary>
    TimestampOutOfRange,
    /// <summary><c>X-Milofly-Key-Id</c> matches none of the configured secrets.</summary>
    UnknownKey,
    /// <summary>The signature does not match.</summary>
    SignatureMismatch,
    /// <summary>The body is not a Milofly webhook envelope.</summary>
    BodyInvalid,
    /// <summary>The envelope's topic/store differ from the signed headers.</summary>
    EnvelopeMismatch,
}

/// <summary>Thrown by <see cref="WebhookVerifier.Verify(IEnumerable{string}, Func{string, string?}, ReadOnlySpan{byte}, DateTimeOffset?, TimeSpan?)"/>.</summary>
public sealed class WebhookVerificationException(WebhookVerificationError error, string? message = null)
    : Exception(message ?? error.ToString())
{
    /// <summary>Stable reason.</summary>
    public WebhookVerificationError Error { get; } = error;
}

/// <summary>A verified delivery.</summary>
/// <param name="Topic">Event topic (e.g. <c>order.created</c>).</param>
/// <param name="StoreId">Store the event belongs to.</param>
/// <param name="Timestamp">Unix seconds of this delivery attempt.</param>
/// <param name="KeyId">Id of the secret that signed it (<c>null</c> on older deliveries).</param>
/// <param name="EventId">Stable per event: store it and ignore a second delivery with the same id.</param>
/// <param name="RegionId">Region of the event, when it has one.</param>
/// <param name="Envelope">Full envelope (<c>version</c>, <c>topic</c>, <c>storeId</c>, <c>regionId</c>, <c>eventId</c>, <c>occurredAt</c>, <c>data</c>).</param>
public sealed record VerifiedWebhook(string Topic, long StoreId, long Timestamp, string? KeyId, string EventId, long? RegionId, JsonElement Envelope);

/// <summary>
/// Verifies Milofly webhook deliveries. Signature: <c>HMAC-SHA256(secret, "{topic}\n{storeId}\n{timestamp}\n{body}")</c>,
/// lower-case hex, in <c>X-Milofly-Hmac-Sha256</c>. Topic, store and timestamp are signed, so no header can be swapped.
/// </summary>
public static class WebhookVerifier
{
    /// <summary>Signature header.</summary>
    public const string SignatureHeader = "X-Milofly-Hmac-Sha256";
    /// <summary>Topic header.</summary>
    public const string TopicHeader = "X-Milofly-Topic";
    /// <summary>Store id header.</summary>
    public const string StoreHeader = "X-Milofly-Store";
    /// <summary>Timestamp header (Unix seconds of the attempt).</summary>
    public const string TimestampHeader = "X-Milofly-Timestamp";
    /// <summary>Key id header (see <see cref="SigningKeyId"/>). Absent on older deliveries.</summary>
    public const string KeyIdHeader = "X-Milofly-Key-Id";

    /// <summary>Replay window. Every attempt is signed with a fresh timestamp, so retries stay inside it.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Verifies a delivery. <paramref name="getHeader"/> returns a header value by name (case-insensitive),
    /// e.g. <c>name =&gt; request.Headers[name].ToString()</c>; <paramref name="rawBody"/> are the body bytes
    /// EXACTLY as received (do not parse and re-serialize). Pass the previous secret too during a rotation.
    /// </summary>
    /// <exception cref="WebhookVerificationException">The delivery is not authentic or not well-formed.</exception>
    public static VerifiedWebhook Verify(IEnumerable<string> secrets, Func<string, string?> getHeader, ReadOnlySpan<byte> rawBody,
        DateTimeOffset? now = null, TimeSpan? tolerance = null)
    {
        var list = Hmac.NormalizeSecrets(secrets);
        ArgumentNullException.ThrowIfNull(getHeader);
        string? H(string name) { var v = getHeader(name); return string.IsNullOrEmpty(v) ? null : v; }

        var signature = H(SignatureHeader);
        var topic = H(TopicHeader);
        var storeRaw = H(StoreHeader);
        var tsRaw = H(TimestampHeader);
        var keyId = H(KeyIdHeader);
        if (signature is null || topic is null || storeRaw is null || tsRaw is null)
            throw new WebhookVerificationException(WebhookVerificationError.MissingHeader);
        if (!long.TryParse(storeRaw, out var storeId) || !long.TryParse(tsRaw, out var ts)
            || storeId.ToString() != storeRaw || ts.ToString() != tsRaw)
            throw new WebhookVerificationException(WebhookVerificationError.MalformedHeader);

        var nowUnix = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        if (Math.Abs(nowUnix - ts) > (long)(tolerance ?? Tolerance).TotalSeconds)
            throw new WebhookVerificationException(WebhookVerificationError.TimestampOutOfRange);

        IEnumerable<string> candidates = list;
        if (keyId is not null)
        {
            var match = list.FirstOrDefault(s => SigningKeyId.From(s) == keyId)
                ?? throw new WebhookVerificationException(WebhookVerificationError.UnknownKey, $"No configured secret has key id {keyId}.");
            candidates = [match];
        }

        var prefix = Encoding.UTF8.GetBytes($"{topic}\n{storeRaw}\n{tsRaw}\n");
        var signed = new byte[prefix.Length + rawBody.Length];
        prefix.CopyTo(signed, 0);
        rawBody.CopyTo(signed.AsSpan(prefix.Length));
        var sig = signature.Trim();
        if (!candidates.Any(s => Hmac.VerifyHex(s, signed, sig)))
            throw new WebhookVerificationException(WebhookVerificationError.SignatureMismatch);

        JsonElement envelope;
        try
        {
            using var doc = JsonDocument.Parse(rawBody.ToArray());
            envelope = doc.RootElement.Clone();
        }
        catch (JsonException) { throw new WebhookVerificationException(WebhookVerificationError.BodyInvalid); }

        if (envelope.ValueKind != JsonValueKind.Object
            || !envelope.TryGetProperty("eventId", out var ev) || ev.ValueKind != JsonValueKind.String
            || !envelope.TryGetProperty("topic", out var t) || t.ValueKind != JsonValueKind.String
            || !envelope.TryGetProperty("storeId", out var s) || s.ValueKind != JsonValueKind.Number)
            throw new WebhookVerificationException(WebhookVerificationError.BodyInvalid);
        if (t.GetString() != topic || !s.TryGetInt64(out var bodyStore) || bodyStore != storeId)
            throw new WebhookVerificationException(WebhookVerificationError.EnvelopeMismatch);

        long? regionId = envelope.TryGetProperty("regionId", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetInt64() : null;
        return new VerifiedWebhook(topic, storeId, ts, keyId, ev.GetString()!, regionId, envelope);
    }

    /// <summary>String-body overload (the string must be the body exactly as received).</summary>
    public static VerifiedWebhook Verify(IEnumerable<string> secrets, Func<string, string?> getHeader, string rawBody,
        DateTimeOffset? now = null, TimeSpan? tolerance = null) =>
        Verify(secrets, getHeader, Encoding.UTF8.GetBytes(rawBody), now, tolerance);
}
