using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.DTOs.Telemetry;
using ScadaApi.Models;

namespace ScadaApi.Services;

public class TelemetryService : ITelemetryService
{
    private readonly ScadaDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ILogger<TelemetryService> _logger;

    public TelemetryService(ScadaDbContext db, IConfiguration cfg, ILogger<TelemetryService> logger)
    {
        _db = db;
        _cfg = cfg;
        _logger = logger;
    }

    public async Task<Dictionary<string, object?>> GetLatestAsync(string deviceId)
    {
        _logger.LogDebug("Getting latest telemetry for device {DeviceId}", deviceId);

        var deviceExists = await _db.Devices.AnyAsync(d => d.Id == deviceId);
        if (!deviceExists)
        {
            _logger.LogWarning("Device {DeviceId} not found when querying latest telemetry", deviceId);
            throw new InvalidOperationException($"Device '{deviceId}' not found");
        }

        var latest = await _db.TelemetryRecords
            .Where(t => t.DeviceId == deviceId)
            .GroupBy(t => t.Tag)
            .Select(g => g.OrderByDescending(t => t.Timestamp).First())
            .AsNoTracking()
            .ToListAsync();

        return latest.ToDictionary(t => t.Tag, t => DeserializeValue(t.Value));
    }

    public async Task<int> PushAsync(string deviceId, Dictionary<string, JsonElement> payload)
    {
        _logger.LogDebug("Pushing {Count} values for device {DeviceId}", payload?.Count ?? 0, deviceId);

        var device = await _db.Devices.FindAsync(deviceId);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found for telemetry push", deviceId);
            throw new InvalidOperationException($"Device '{deviceId}' not found");
        }

        if (payload is null || payload.Count == 0)
            throw new InvalidOperationException("Telemetry payload cannot be empty");

        var now = DateTime.UtcNow;
        var records = payload
            .Where(kv => kv.Key.StartsWith(deviceId + "."))
            .Select(kv => new TelemetryRecord
            {
                DeviceId = deviceId,
                Tag = kv.Key,
                Value = SerializeValue(kv.Value),
                Timestamp = now,
            })
            .ToList();

        device.LastSeenAt = now;
        await _db.TelemetryRecords.AddRangeAsync(records);
        await _db.SaveChangesAsync();

        _logger.LogDebug("Stored {Count} telemetry records", records.Count);
        return records.Count;
    }

    public async Task<List<HistoryPoint>> GetHistoryAsync(
        string deviceId, string tag, DateTime? from, DateTime? to, int limit)
    {
        _logger.LogDebug("Getting history for device {DeviceId}, tag {Tag}", deviceId, tag);

        var maxRecords = _cfg.GetValue<int>("Telemetry:MaxRecordsPerQuery", 5000);
        limit = Math.Min(limit, maxRecords);

        var dtFrom = from ?? DateTime.UtcNow.AddHours(-1);
        var dtTo = to ?? DateTime.UtcNow;

        var records = await _db.TelemetryRecords
            .Where(t =>
                t.DeviceId == deviceId &&
                t.Tag == tag &&
                t.Timestamp >= dtFrom &&
                t.Timestamp <= dtTo)
            .OrderBy(t => t.Timestamp)
            .Take(limit)
            .AsNoTracking()
            .ToListAsync();

        return records
            .Select(r => new HistoryPoint(r.Timestamp, DeserializeValue(r.Value)))
            .ToList();
    }

    public async Task<int> PurgeAsync(string deviceId)
    {
        var retentionDays = _cfg.GetValue<int>("Telemetry:RetentionDays", 30);
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);

        _logger.LogInformation("Purging telemetry older than {CutoffDate} for device {DeviceId}", cutoff, deviceId);

        var records = await _db.TelemetryRecords
            .Where(t => t.DeviceId == deviceId && t.Timestamp < cutoff)
            .ToListAsync();

        _db.TelemetryRecords.RemoveRange(records);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Purged {Count} records", records.Count);
        return records.Count;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static object? DeserializeValue(string json)
    {
        try
        {
            var el = JsonSerializer.Deserialize<JsonElement>(json);
            return el.ValueKind switch
            {
                JsonValueKind.True => (object)true,
                JsonValueKind.False => false,
                JsonValueKind.Number => el.GetDouble(),
                JsonValueKind.String => el.GetString(),
                _ => json,
            };
        }
        catch
        {
            return json;
        }
    }

    private static string SerializeValue(JsonElement el) =>
        el.ValueKind == JsonValueKind.String
            ? JsonSerializer.Serialize(el.GetString())
            : el.GetRawText();
}
