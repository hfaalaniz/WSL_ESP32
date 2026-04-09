using ScadaApi.DTOs.Alarms;
using ScadaApi.Models;

namespace ScadaApi.Services;

public interface IAlarmService
{
    Task<List<AlarmResponse>> GetAllAsync(string deviceId, bool? activeOnly = null, string? level = null, DateTime? from = null, DateTime? to = null, int limit = 100);
    Task<AlarmSummary> GetSummaryAsync(string deviceId);
    Task<AlarmResponse> CreateAsync(string deviceId, CreateAlarmRequest req);
    Task<AlarmResponse?> AcknowledgeAsync(string deviceId, long alarmId, string? ackedBy);
    Task<int> AcknowledgeAllAsync(string deviceId, string? ackedBy);
}
