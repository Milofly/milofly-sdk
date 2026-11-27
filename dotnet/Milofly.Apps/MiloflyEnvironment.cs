namespace Milofly.Apps;

/// <summary>
/// Milofly endpoints. There is no implicit environment: pass <see cref="Production"/> or your own
/// values (a local Milofly) to the verifiers and clients.
/// </summary>
/// <param name="ApiBaseUrl">Base of the app API (<c>/api/apps/**</c>).</param>
/// <param name="PanelOrigin">Origin of the store panel that embeds apps and shows the install screen.</param>
public sealed record MiloflyEnvironment(Uri ApiBaseUrl, Uri PanelOrigin)
{
    /// <summary>Published production endpoints.</summary>
    public static MiloflyEnvironment Production { get; } =
        new(new Uri("https://api.milofly.com"), new Uri("https://app.milofly.com"));
}
