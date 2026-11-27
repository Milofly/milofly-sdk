# Milofly.Apps

.NET helpers for Milofly apps (net8.0+, no dependencies beyond the BCL).

```
dotnet add package Milofly.Apps
```

| Type | Purpose |
|---|---|
| `WebhookVerifier` | Verify `X-Milofly-Hmac-Sha256` (topic, store, timestamp signed) + 5-minute replay window; returns the envelope and `EventId` for de-duplication. |
| `SessionTokenVerifier` | Verify the session token your embedded page got from App Bridge; returns store, region, panel user, surface, host origin. |
| `OAuthClient` | Install screen URL and install code → access token exchange. |
| `MiloflyApiClient` | Authenticated client for `/api/apps/**` (coded `MiloflyApiException`, 429 only within `RateLimitRetry`). |
| `SigningKeyId` | Id of a signing secret (`X-Milofly-Key-Id`, token `Kid`). |
| `MiloflyEnvironment` | Endpoints; no implicit environment (`MiloflyEnvironment.Production` or your own). |

```csharp
app.MapPost("/webhooks/milofly", async (HttpRequest req) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);                       // raw bytes, never re-serialized
    try
    {
        var hook = WebhookVerifier.Verify([secret], name => req.Headers[name].ToString(), ms.ToArray());
        // hook.EventId → ignore duplicates
        return Results.Ok();
    }
    catch (WebhookVerificationException) { return Results.Unauthorized(); }
});
```
