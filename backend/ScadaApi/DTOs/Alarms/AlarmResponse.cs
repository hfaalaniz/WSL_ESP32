namespace ScadaApi.DTOs.Alarms;

/// <summary>Respuesta DTO para una alarma.</summary>
public record AlarmResponse(
    long Id,
    string DeviceId,
    string Message,
    string Level,
    string? Tag,
    bool IsActive,
    DateTime TriggeredAt,
    DateTime? AckedAt,
    string? AckedBy
);
