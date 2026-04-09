namespace ScadaApi.DTOs.Firmware;

public class CompileRequest
{
    public string ProjectId { get; set; } = "";
    public string ProjectName { get; set; } = "sketch";
    public string Code { get; set; } = "";
    public string BoardId { get; set; } = "esp32:esp32:esp32";
}
