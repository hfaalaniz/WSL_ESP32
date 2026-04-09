using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Firmware;
using ScadaApi.Services;
using System.Text;
using System.Text.Json;

namespace ScadaApi.Controllers;

[ApiController]
[Route("api/firmware")]
[Produces("application/json")]
public class FirmwareController : ControllerBase
{
    private readonly ICompilationService _compilationService;
    private readonly ILogger<FirmwareController> _logger;

    public FirmwareController(ICompilationService compilationService, ILogger<FirmwareController> logger)
    {
        _compilationService = compilationService;
        _logger = logger;
    }

    /// <summary>Compila código Arduino con arduino-cli y retorna el binario en base64.</summary>
    [HttpPost("compile")]
    [ProducesResponseType<CompilationResult>(200)]
    public async Task<IActionResult> Compile([FromBody] CompileRequest request)
    {
        _logger.LogInformation("Compilando firmware para proyecto {ProjectId} con board {BoardId}",
            request.ProjectId, request.BoardId);

        if (string.IsNullOrWhiteSpace(request.Code))
        {
            _logger.LogWarning("Código vacío para compilación");
            return BadRequest(new CompilationResult { Error = "El código no puede estar vacío" });
        }

        var result = await _compilationService.CompileAsync(request);
        return Ok(result);
    }

    /// <summary>
    /// Compila firmware con streaming SSE de logs en tiempo real.
    /// Cada evento SSE lleva "data: LOG: ..." o "data: RESULT:{json}" al final.
    /// </summary>
    [HttpPost("compile-stream")]
    [Produces("text/event-stream")]
    public async Task CompileStream([FromBody] CompileRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            Response.StatusCode = 400;
            return;
        }

        Response.Headers["Content-Type"]  = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no"; // para Nginx
        Response.Headers["Access-Control-Allow-Origin"] = "*";

        await Response.StartAsync(ct);

        _logger.LogInformation("SSE compile-stream para proyecto {ProjectId}", request.ProjectId);

        try
        {
            await foreach (var line in _compilationService.CompileStreamAsync(request, ct))
            {
                var sseData = $"data: {line}\n\n";
                await Response.Body.WriteAsync(Encoding.UTF8.GetBytes(sseData), ct);
                await Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // cliente desconectado — normal
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error en compile-stream");
            var errLine = $"data: ERROR: {ex.Message}\n\n";
            try { await Response.Body.WriteAsync(Encoding.UTF8.GetBytes(errLine), ct); } catch { /* ignore */ }
        }
    }
}
