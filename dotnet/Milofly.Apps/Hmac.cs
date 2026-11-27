using System.Security.Cryptography;
using System.Text;

namespace Milofly.Apps;

/// <summary>HMAC-SHA256 helpers shared by the verifiers. Signatures are compared in constant time.</summary>
internal static class Hmac
{
    public static byte[] Compute(string secret, ReadOnlySpan<byte> data)
    {
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return h.ComputeHash(data.ToArray());
    }

    public static string ComputeHex(string secret, ReadOnlySpan<byte> data) =>
        Convert.ToHexString(Compute(secret, data)).ToLowerInvariant();

    /// <summary>Constant-time check of a hex signature (any case).</summary>
    public static bool VerifyHex(string secret, ReadOnlySpan<byte> data, string signatureHex)
    {
        if (signatureHex.Length != 64) return false;
        byte[] given;
        try { given = Convert.FromHexString(signatureHex); }
        catch (FormatException) { return false; }
        return CryptographicOperations.FixedTimeEquals(Compute(secret, data), given);
    }

    public static IReadOnlyList<string> NormalizeSecrets(IEnumerable<string> secrets)
    {
        ArgumentNullException.ThrowIfNull(secrets);
        var list = secrets.ToList();
        if (list.Count == 0 || list.Any(string.IsNullOrEmpty))
            throw new ArgumentException("Pass at least one non-empty signing secret.", nameof(secrets));
        return list;
    }
}

/// <summary>
/// Identifier of a signing secret, sent by Milofly as <c>X-Milofly-Key-Id</c> (webhooks) and <c>Kid</c>
/// (session tokens): first 16 hex characters of HMAC-SHA256(key = secret, message = "milofly-key-id-v1").
/// It changes when the secret changes and reveals nothing about it.
/// </summary>
public static class SigningKeyId
{
    /// <summary>Message signed to derive the id.</summary>
    public const string Domain = "milofly-key-id-v1";

    /// <summary>Key id of <paramref name="secret"/>.</summary>
    public static string From(string secret)
    {
        ArgumentException.ThrowIfNullOrEmpty(secret);
        return Hmac.ComputeHex(secret, Encoding.UTF8.GetBytes(Domain))[..16];
    }
}
