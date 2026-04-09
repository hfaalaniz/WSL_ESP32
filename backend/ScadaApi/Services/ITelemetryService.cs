using System.Text.Json;
using ScadaApi.DTOs.Telemetry;

namespace ScadaApi.Services;

public interface ITelemetryService
{
    Task<Dictionary<string, object?>> GetLatestAsync(string deviceId);
    Task<int> PushAsync(string deviceId, Dictionary<string, JsonElement> payload);
    Task<List<HistoryPoint>> GetHistoryAsync(string deviceId, string tag, DateTime? from, DateTime? to, int limit);
    Task<int> PurgeAsync(string deviceId);
}
