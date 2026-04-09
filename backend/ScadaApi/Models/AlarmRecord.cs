namespace ScadaApi.Models;

/// <summary>
/// Registro de una alarma generada por el script WSL o por el servidor.
/// </summary>
public class AlarmRecord
{
    public long      Id          { get; set; }
    public string    DeviceId    { get; set; } = "";

    /// <summary>Mensaje de la alarma</summary>
    public string    Message     { get; set; } = "";

    /// <summary>Severidad: INFO | WARN | CRITICAL</summary>
    public string    Level       { get; set; } = "INFO";

    /// <summary>Tag relacionado (opcional, puede ser null)</summary>
    public string?   Tag         { get; set; }

    public DateTime  TriggeredAt { get; set; } = DateTime.UtcNow;
    public DateTime? AckedAt     { get; set; }
    public string?   AckedBy     { get; set; }

    /// <summary>true = alarma activa (no confirmada)</summary>
    public bool      IsActive    { get; set; } = true;

    // Navegación EF
    public Device?   Device      { get; set; }
}
