using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Alarms;
using ScadaApi.Services;

namespace ScadaApi.Controllers;

[ApiController]
[Route("api/devices/{deviceId}/alarms")]
[Produces("application/json")]
public class AlarmsController : ControllerBase
{
    private readonly IAlarmService _alarmService;
    private readonly ILogger<AlarmsController> _logger;

    public AlarmsController(IAlarmService alarmService, ILogger<AlarmsController> logger)
    {
        _alarmService = alarmService;
        _logger = logger;
    }

    // ── Endpoints ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Lista alarmas del dispositivo.
    /// Filtros opcionales: activeOnly, level, from, to.
    /// </summary>
    [HttpGet]
    [ProducesResponseType<List<AlarmResponse>>(200)]
    public async Task<IActionResult> GetAll(
        string deviceId,
        [FromQuery] bool?   activeOnly = null,
        [FromQuery] string? level      = null,
        [FromQuery] DateTime? from     = null,
        [FromQuery] DateTime? to       = null,
        [FromQuery] int       limit    = 100)
    {
        _logger.LogInformation("Fetching alarms for device {DeviceId} (activeOnly={ActiveOnly}, level={Level})", 
            deviceId, activeOnly, level);
        
        var alarms = await _alarmService.GetAllAsync(deviceId, activeOnly, level, from, to, limit);
        return Ok(alarms);
    }

    /// <summary>
    /// Cuenta alarmas activas por nivel para el dashboard.
    /// </summary>
    [HttpGet("summary")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Summary(string deviceId)
    {
        _logger.LogInformation("Fetching alarm summary for device {DeviceId}", deviceId);
        
        var summary = await _alarmService.GetSummaryAsync(deviceId);
        return Ok(summary);
    }

    /// <summary>
    /// Crea una nueva alarma manualmente o desde el script WSL vía backend.
    /// </summary>
    [HttpPost]
    [ProducesResponseType<AlarmResponse>(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Create(
        string deviceId,
        [FromBody] CreateAlarmRequest req)
    {
        _logger.LogInformation("Creating alarm for device {DeviceId}: {Message} [{Level}]", 
            deviceId, req.Message, req.Level);
        
        try
        {
            var alarm = await _alarmService.CreateAsync(deviceId, req);
            _logger.LogInformation("Alarm created for device {DeviceId} with ID {AlarmId}", deviceId, alarm.Id);
            return CreatedAtAction(nameof(GetAll), new { deviceId }, alarm);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to create alarm for device {DeviceId}", deviceId);
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Confirma (ACK) una alarma.
    /// </summary>
    [HttpPut("{id}/ack")]
    [ProducesResponseType<AlarmResponse>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Acknowledge(
        string deviceId,
        long   id,
        [FromBody] AckRequest req)
    {
        _logger.LogInformation("Acknowledging alarm {AlarmId} for device {DeviceId} by {AckedBy}", 
            id, deviceId, req.AckedBy ?? "operator");
        
        var alarm = await _alarmService.AcknowledgeAsync(deviceId, id, req.AckedBy);
        if (alarm is null)
        {
            _logger.LogWarning("Alarm {AlarmId} not found for device {DeviceId}", id, deviceId);
            return NotFound();
        }
        
        return Ok(alarm);
    }

    /// <summary>
    /// Confirma todas las alarmas activas de un dispositivo.
    /// </summary>
    [HttpPut("ack-all")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> AcknowledgeAll(
        string deviceId,
        [FromBody] AckRequest req)
    {
        _logger.LogInformation("Acknowledging all alarms for device {DeviceId} by {AckedBy}", 
            deviceId, req.AckedBy ?? "operator");
        
        var count = await _alarmService.AcknowledgeAllAsync(deviceId, req.AckedBy);
        _logger.LogInformation("Acknowledged {Count} alarms for device {DeviceId}", count, deviceId);
        
        return Ok(new { acknowledged = count });
    }
}
