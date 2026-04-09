namespace ScadaApi.Models;

/// <summary>
/// Comando pendiente de ejecución por el ESP32.
/// El frontend los encola; el ESP32 los descarga y confirma.
/// </summary>
public class PendingCommand
{
    public long      Id         { get; set; }
    public string    DeviceId   { get; set; } = "";

    /// <summary>Tag a modificar (ej: "esp01.595.out.0")</summary>
    public string    Tag        { get; set; } = "";

    /// <summary>Valor en JSON (ej: "true", "3.14", "\"encendido\"")</summary>
    public string    Value      { get; set; } = "0";

    /// <summary>Origen del comando: "UI" | "SCRIPT" | "ALARM"</summary>
    public string    Source     { get; set; } = "UI";

    public DateTime  CreatedAt  { get; set; } = DateTime.UtcNow;
    public DateTime? ExecutedAt { get; set; }

    public bool IsExecuted => ExecutedAt.HasValue;

    // Navegación EF
    public Device? Device { get; set; }
}
