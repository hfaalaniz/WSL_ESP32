namespace ScadaApi.DTOs.Firmware;

public class CompilationResult
{
    public bool Success { get; set; }
    public string? Binary { get; set; }
    public string Logs { get; set; } = "";
    public string? Error { get; set; }
}
