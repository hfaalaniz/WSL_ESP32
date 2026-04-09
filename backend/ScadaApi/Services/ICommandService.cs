using ScadaApi.DTOs.Commands;

namespace ScadaApi.Services;

public interface ICommandService
{
    Task<List<CommandResponse>> GetAllAsync(string deviceId, bool? pendingOnly = null, int limit = 50);
    Task<List<CommandResponse>> GetPendingAsync(string deviceId);
    Task<CommandResponse?> CreateAsync(string deviceId, CreateCommandRequest request);
    Task<CommandResponse?> MarkDoneAsync(string deviceId, long commandId);
    Task<int> PurgeAsync(string deviceId, int days);
}
