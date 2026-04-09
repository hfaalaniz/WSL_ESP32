using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Telemetry;
using ScadaApi.Services;
using System.Text.Json;

namespace ScadaApi.Controllers;

[ApiController]
[Route("api/devices/{deviceId}/telemetry")]
[Produces("application/json")]
public class TelemetryController : ControllerBase
{
    private readonly ITelemetryService _telemetryService;
    private readonly ILogger<TelemetryController> _logger;

    public TelemetryController(ITelemetryService telemetryService, ILogger<TelemetryController> logger)
    {
        _telemetryService = telemetryService;
        _logger = logger;
    }

    // ── Endpoints ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Retorna el último valor conocido de todos los tags del dispositivo.
    /// Compatible con GET /api/telemetry del firmware ESP32.
    /// </summary>
    [HttpGet]
    [ProducesResponseType<Dictionary<string, object>>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetLatest(string deviceId)
    {
        _logger.LogInformation("Fetching latest telemetry for device {DeviceId}", deviceId);
        
        try
        {
            var result = await _telemetryService.GetLatestAsync(deviceId);
            return Ok(result);
        }
        catch (InvalidOperationException)
        {
            _logger.LogWarning("Device {DeviceId} not found", deviceId);
            return NotFound();
        }
    }

    /// <summary>
    /// Recibe un lote de telemetría enviado por el ESP32.
    /// Body: objeto JSON plano { "tag": valor, ... }
    ///
    /// Ejemplo:
    /// {
    ///   "esp01.din.gpio4": false,
    ///   "esp01.ain.adc32": 1234.5,
    ///   "esp01.595.out.0": true
    /// }
    /// </summary>
    [HttpPost]
    [ProducesResponseType(204)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Push(
        string deviceId,
        [FromBody] Dictionary<string, JsonElement> payload)
    {
        _logger.LogDebug("Receiving telemetry for {DeviceId} with {Count} records", deviceId, payload?.Count ?? 0);
        
        if (payload is null || payload.Count == 0)
        {
            _logger.LogWarning("Empty telemetry payload received for {DeviceId}", deviceId);
            return BadRequest(new { error = "Payload vacío" });
        }
        
        try
        {
            var count = await _telemetryService.PushAsync(deviceId, payload);
            _logger.LogInformation("Pushed {Count} telemetry records for device {DeviceId}", count, deviceId);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Device {DeviceId} not found", deviceId);
            return NotFound(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Consulta el historial de un tag en un rango de tiempo.
    /// </summary>
    /// <param name="deviceId">ID del dispositivo</param>
    /// <param name="tag">Nombre del tag (ej: esp01.ain.adc32)</param>
    /// <param name="from">Desde (ISO 8601, default: -1h)</param>
    /// <param name="to">Hasta (ISO 8601, default: ahora)</param>
    /// <param name="limit">Máximo de puntos a retornar</param>
    [HttpGet("history")]
    [ProducesResponseType<List<HistoryPoint>>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetHistory(
        string deviceId,
        [FromQuery] string  tag,
        [FromQuery] DateTime? from  = null,
        [FromQuery] DateTime? to    = null,
        [FromQuery] int       limit = 1000)
    {
        _logger.LogInformation("Fetching history for {DeviceId}.{Tag} (from={From}, to={To})", deviceId, tag, from?.ToShortDateString() ?? "default", to?.ToShortDateString() ?? "now");
        
        if (string.IsNullOrWhiteSpace(tag))
        {
            _logger.LogWarning("GetHistory called without tag parameter");
            return BadRequest(new { error = "Parámetro 'tag' requerido" });
        }
        
        try
        {
            var history = await _telemetryService.GetHistoryAsync(deviceId, tag, from, to, limit);
            return Ok(history);
        }
        catch (InvalidOperationException)
        {
            _logger.LogWarning("Device {DeviceId} not found", deviceId);
            return NotFound();
        }
    }

    /// <summary>
    /// Elimina registros de telemetría más viejos que RetentionDays.
    /// Llamar periódicamente (ej: tarea programada).
    /// </summary>
    [HttpDelete("purge")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Purge(string deviceId)
    {
        _logger.LogWarning("Purging old telemetry records for device {DeviceId}", deviceId);
        
        try
        {
            var deleted = await _telemetryService.PurgeAsync(deviceId);
            _logger.LogInformation("Purged {DeletedCount} telemetry records for device {DeviceId}", deleted, deviceId);
            return Ok(new { deleted, message = $"Purged {deleted} records" });
        }
        catch (InvalidOperationException)
        {
            _logger.LogWarning("Device {DeviceId} not found for purge", deviceId);
            return NotFound();
        }
    }
}
