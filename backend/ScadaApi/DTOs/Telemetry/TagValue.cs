namespace ScadaApi.DTOs.Telemetry;

/// <summary>Representa el valor actual de un tag SCADA.</summary>
public record TagValue(
    string Tag,
    object? Value,
    DateTime Timestamp
);
