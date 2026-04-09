namespace ScadaApi.DTOs.Telemetry;

/// <summary>Punto de histórico de un tag (timestamp + valor).</summary>
public record HistoryPoint(
    DateTime Timestamp,
    object? Value
);
