using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.DTOs.Commands;
using ScadaApi.Models;

namespace ScadaApi.Services;

public class CommandService : ICommandService
{
    private readonly ScadaDbContext _db;
    private readonly ILogger<CommandService> _logger;

    public CommandService(ScadaDbContext db, ILogger<CommandService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<CommandResponse>> GetAllAsync(string deviceId, bool? pendingOnly = null, int limit = 50)
    {
        var query = _db.PendingCommands.Where(c => c.DeviceId == deviceId);
        if (pendingOnly == true) query = query.Where(c => c.ExecutedAt == null);

        var commands = await query
            .OrderByDescending(c => c.CreatedAt)
            .Take(Math.Min(limit, 500))
            .AsNoTracking()
            .ToListAsync();

        return commands.Select(ToResponse).ToList();
    }

    public async Task<List<CommandResponse>> GetPendingAsync(string deviceId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device is not null)
        {
            device.LastSeenAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        var commands = await _db.PendingCommands
            .Where(c => c.DeviceId == deviceId && c.ExecutedAt == null)
            .OrderBy(c => c.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return commands.Select(ToResponse).ToList();
    }

    public async Task<CommandResponse?> CreateAsync(string deviceId, CreateCommandRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Tag))
        {
            throw new ArgumentException("El campo 'tag' es requerido", nameof(request.Tag));
        }

        if (!await _db.Devices.AnyAsync(d => d.Id == deviceId))
        {
            return null;
        }

        var value = request.Value.ValueKind == JsonValueKind.String
            ? JsonSerializer.Serialize(request.Value.GetString())
            : request.Value.GetRawText();

        var command = new PendingCommand
        {
            DeviceId  = deviceId,
            Tag       = request.Tag,
            Value     = value,
            Source    = request.Source ?? "UI",
            CreatedAt = DateTime.UtcNow,
        };

        _db.PendingCommands.Add(command);
        await _db.SaveChangesAsync();

        return ToResponse(command);
    }

    public async Task<CommandResponse?> MarkDoneAsync(string deviceId, long commandId)
    {
        var command = await _db.PendingCommands
            .FirstOrDefaultAsync(c => c.Id == commandId && c.DeviceId == deviceId);

        if (command is null)
        {
            return null;
        }

        command.ExecutedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return ToResponse(command);
    }

    public async Task<int> PurgeAsync(string deviceId, int days)
    {
        var cutoff = DateTime.UtcNow.AddDays(-days);

        var oldCommands = await _db.PendingCommands
            .Where(c => c.DeviceId == deviceId && c.ExecutedAt < cutoff)
            .ToListAsync();

        _db.PendingCommands.RemoveRange(oldCommands);
        await _db.SaveChangesAsync();

        return oldCommands.Count;
    }

    private static object? DeserializeValue(string json)
    {
        try
        {
            var el = JsonSerializer.Deserialize<JsonElement>(json);
            return el.ValueKind switch
            {
                JsonValueKind.True   => true,
                JsonValueKind.False  => false,
                JsonValueKind.Number => el.GetDouble(),
                JsonValueKind.String => el.GetString(),
                _                   => json,
            };
        }
        catch
        {
            return json;
        }
    }

    private static CommandResponse ToResponse(PendingCommand command) => new(
        command.Id,
        command.Tag,
        DeserializeValue(command.Value),
        command.Source,
        command.CreatedAt,
        command.ExecutedAt,
        command.IsExecuted
    );
}
