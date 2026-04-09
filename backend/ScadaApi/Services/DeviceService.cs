using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.DTOs.Device;
using ScadaApi.Models;

namespace ScadaApi.Services;

public class DeviceService : IDeviceService
{
    private readonly ScadaDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ILogger<DeviceService> _logger;

    public DeviceService(ScadaDbContext db, IConfiguration cfg, ILogger<DeviceService> logger)
    {
        _db = db;
        _cfg = cfg;
        _logger = logger;
    }

    public async Task<List<DeviceResponse>> GetAllAsync()
    {
        _logger.LogDebug("Fetching all devices");
        var devices = await _db.Devices.AsNoTracking().ToListAsync();
        return devices.Select(ToResponse).ToList();
    }

    public async Task<DeviceResponse?> GetByIdAsync(string id)
    {
        _logger.LogDebug("Fetching device {DeviceId}", id);
        var device = await _db.Devices.FindAsync(id);
        return device is null ? null : ToResponse(device);
    }

    public async Task<DeviceResponse> CreateAsync(CreateDeviceRequest req)
    {
        _logger.LogInformation("Creating device {DeviceId}", req.Id);

        if (string.IsNullOrWhiteSpace(req.Id))
        {
            _logger.LogWarning("Device Id is required");
            throw new InvalidOperationException("Device Id is required");
        }

        if (string.IsNullOrWhiteSpace(req.Name))
        {
            _logger.LogWarning("Device Name is required");
            throw new InvalidOperationException("Device Name is required");
        }

        if (await _db.Devices.AnyAsync(d => d.Id == req.Id.Trim().ToLower()))
        {
            _logger.LogWarning("Device {DeviceId} already exists", req.Id);
            throw new InvalidOperationException($"Device with Id '{req.Id}' already exists");
        }

        var device = new Device
        {
            Id = req.Id.Trim().ToLower(),
            Name = req.Name,
            Description = req.Description ?? "",
            Mode = req.Mode ?? "AUTO",
            IpAddress = req.IpAddress,
            Port = req.Port ?? 80,
            HardwareConfig = req.HardwareConfig,
        };

        _db.Devices.Add(device);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Device {DeviceId} created successfully", device.Id);
        return ToResponse(device);
    }

    public async Task<DeviceResponse?> UpdateAsync(string id, UpdateDeviceRequest req)
    {
        _logger.LogInformation("Updating device {DeviceId}", id);
        var device = await _db.Devices.FindAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found", id);
            return null;
        }

        if (req.Name != null) device.Name = req.Name;
        if (req.Description != null) device.Description = req.Description;
        if (req.Mode != null) device.Mode = req.Mode;
        if (req.IpAddress != null) device.IpAddress = req.IpAddress;
        if (req.Port.HasValue) device.Port = req.Port.Value;
        if (req.HardwareConfig != null) device.HardwareConfig = req.HardwareConfig;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Device {DeviceId} updated", id);
        return ToResponse(device);
    }

    public async Task<bool> DeleteAsync(string id)
    {
        _logger.LogInformation("Deleting device {DeviceId}", id);
        var device = await _db.Devices.FindAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found for deletion", id);
            return false;
        }

        _db.Devices.Remove(device);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Device {DeviceId} deleted", id);
        return true;
    }

    public async Task<bool> PingAsync(string id, string? ip)
    {
        var device = await _db.Devices.FindAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Ping from unknown device {DeviceId}", id);
            return false;
        }

        device.LastSeenAt = DateTime.UtcNow;
        if (ip is not null) device.IpAddress = ip;

        await _db.SaveChangesAsync();
        _logger.LogDebug("Device {DeviceId} ping received from {Ip}", id, ip);
        return true;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private DeviceResponse ToResponse(Device d)
    {
        var isOnline = IsOnline(d);
        return new DeviceResponse(
            d.Id, d.Name, d.Description, d.Mode,
            d.IpAddress, d.Port,
            isOnline,
            d.CreatedAt, d.LastSeenAt,
            d.HardwareConfig is not null
        );
    }

    private bool IsOnline(Device d)
    {
        if (d.LastSeenAt is null) return false;
        var thresholdSec = _cfg.GetValue<int>("Telemetry:OnlineThresholdSeconds", 30);
        return (DateTime.UtcNow - d.LastSeenAt.Value).TotalSeconds <= thresholdSec;
    }
}
