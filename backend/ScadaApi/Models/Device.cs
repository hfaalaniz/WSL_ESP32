namespace ScadaApi.Models;

/// <summary>
/// Dispositivo ESP32 registrado en el sistema.
/// </summary>
public class Device
{
    /// <summary>ID único del dispositivo (ej: "esp01", "compresor-01")</summary>
    public string Id { get; set; } = "";

    public string Name        { get; set; } = "";
    public string Description { get; set; } = "";

    /// <summary>Modo de conexión: LOCAL | REMOTE | AUTO</summary>
    public string Mode { get; set; } = "AUTO";

    public string? IpAddress { get; set; }
    public int     Port       { get; set; } = 80;

    public DateTime  CreatedAt  { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; }

    /// <summary>
    /// Sección [HARDWARE] del archivo .scada en formato JSON.
    /// Se almacena para regenerar tags y validar telemetría.
    /// </summary>
    public string? HardwareConfig { get; set; }

    // Navegación EF
    public ICollection<TelemetryRecord> TelemetryRecords { get; set; } = [];
    public ICollection<AlarmRecord>     AlarmRecords     { get; set; } = [];
    public ICollection<PendingCommand>  PendingCommands  { get; set; } = [];
}
