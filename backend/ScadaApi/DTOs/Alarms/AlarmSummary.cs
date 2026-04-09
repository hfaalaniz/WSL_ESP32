namespace ScadaApi.DTOs.Alarms;

/// <summary>DTO para resumen de alarmas activas agrupadas por nivel.</summary>
public record AlarmSummary(
    int Total,
    int Info,
    int Warn,
    int Critical
);
