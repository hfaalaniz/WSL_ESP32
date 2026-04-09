namespace ScadaApi.DTOs.Alarms;

/// <summary>DTO para reconocer (ACK) una alarma.</summary>
public record AckRequest(
    string? AckedBy
);
