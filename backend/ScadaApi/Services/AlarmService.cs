using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.DTOs.Alarms;
using ScadaApi.Models;

namespace ScadaApi.Services;

public class AlarmService : IAlarmService
{
    private readonly ScadaDbContext _db;
    private readonly ILogger<AlarmService> _logger;

    public AlarmService(ScadaDbContext db, ILogger<AlarmService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<AlarmResponse>> GetAllAsync(
        string deviceId, bool? activeOnly = null, string? level = null,
        DateTime? from = null, DateTime? to = null, int limit = 100)
    {
        _logger.LogDebug("Getting alarms for device {DeviceId}", deviceId);

        var query = _db.AlarmRecords
            .Where(a => a.DeviceId == deviceId);

        if (activeOnly == true) query = query.Where(a => a.IsActive);
        if (level != null) query = query.Where(a => a.Level == level.ToUpper());
        if (from.HasValue) query = query.Where(a => a.TriggeredAt >= from.Value);
        if (to.HasValue) query = query.Where(a => a.TriggeredAt <= to.Value);

        var alarms = await query
            .OrderByDescending(a => a.TriggeredAt)
            .Take(Math.Min(limit, 1000))
            .AsNoTracking()
            .ToListAsync();

        return alarms.Select(ToResponse).ToList();
    }

    public async Task<AlarmSummary> GetSummaryAsync(string deviceId)
    {
        _logger.LogDebug("Getting alarm summary for device {DeviceId}", deviceId);

        var summary = await _db.AlarmRecords
            .Where(a => a.DeviceId == deviceId && a.IsActive)
            .GroupBy(a => a.Level)
            .Select(g => new { Level = g.Key, Count = g.Count() })
            .AsNoTracking()
            .ToListAsync();

        return new AlarmSummary(
            Total: summary.Sum(s => s.Count),
            Info: summary.FirstOrDefault(s => s.Level == "INFO")?.Count ?? 0,
            Warn: summary.FirstOrDefault(s => s.Level == "WARN")?.Count ?? 0,
            Critical: summary.FirstOrDefault(s => s.Level == "CRITICAL")?.Count ?? 0
        );
    }

    public async Task<AlarmResponse> CreateAsync(string deviceId, CreateAlarmRequest req)
    {
        _logger.LogInformation("Creating alarm for device {DeviceId}: {Message}", deviceId, req.Message);

        // Verify device exists
        var device = await _db.Devices.FindAsync(deviceId);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found", deviceId);
            throw new InvalidOperationException($"Device '{deviceId}' not found");
        }

        var validLevels = new[] { "INFO", "WARN", "CRITICAL" };
        if (!validLevels.Contains(req.Level.ToUpper()))
        {
            _logger.LogWarning("Invalid alarm level {Level}", req.Level);
            throw new InvalidOperationException($"Invalid level '{req.Level}'. Expected: INFO, WARN, CRITICAL");
        }

        var alarm = new AlarmRecord
        {
            DeviceId = deviceId,
            Message = req.Message,
            Level = req.Level.ToUpper(),
            Tag = req.Tag,
            TriggeredAt = DateTime.UtcNow,
            IsActive = true,
        };

        var deviceExists = await _db.Devices.AnyAsync(d => d.Id == deviceId);
        if (!deviceExists)
        {
            _logger.LogWarning("Device {DeviceId} not found when creating alarm", deviceId);
            throw new InvalidOperationException($"Device '{deviceId}' does not exist.");
        }

        _db.AlarmRecords.Add(alarm);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Alarm {AlarmId} created", alarm.Id);
        return ToResponse(alarm);
    }

    public async Task<AlarmResponse?> AcknowledgeAsync(string deviceId, long alarmId, string? ackedBy)
    {
        _logger.LogInformation("Acknowledging alarm {AlarmId}", alarmId);

        var alarm = await _db.AlarmRecords
            .FirstOrDefaultAsync(a => a.Id == alarmId && a.DeviceId == deviceId);

        if (alarm is null)
        {
            _logger.LogWarning("Alarm {AlarmId} not found", alarmId);
            return null;
        }

        if (!alarm.IsActive)
        {
            _logger.LogDebug("Alarm {AlarmId} already acknowledged", alarmId);
            return ToResponse(alarm);
        }

        alarm.AckedAt = DateTime.UtcNow;
        alarm.AckedBy = ackedBy ?? "operator";
        alarm.IsActive = false;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Alarm {AlarmId} acknowledged by {AckedBy}", alarmId, alarm.AckedBy);
        return ToResponse(alarm);
    }

    public async Task<int> AcknowledgeAllAsync(string deviceId, string? ackedBy)
    {
        _logger.LogInformation("Acknowledging all alarms for device {DeviceId}", deviceId);

        var now = DateTime.UtcNow;
        var ackBy = ackedBy ?? "operator";

        // Load records first (needed for InMemory provider compatibility)
        var records = await _db.AlarmRecords
            .Where(a => a.DeviceId == deviceId && a.IsActive)
            .ToListAsync();

        foreach (var record in records)
        {
            record.AckedAt = now;
            record.AckedBy = ackBy;
            record.IsActive = false;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Acknowledged {Count} alarms by {AckedBy}", records.Count, ackBy);
        return records.Count;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static AlarmResponse ToResponse(AlarmRecord a) => new(
        a.Id, a.DeviceId, a.Message, a.Level, a.Tag,
        a.IsActive, a.TriggeredAt, a.AckedAt, a.AckedBy
    );
}
