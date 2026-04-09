using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Projects;
using ScadaApi.Services;

namespace ScadaApi.Controllers;

[ApiController]
[Route("api/projects")]
[Produces("application/json")]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _service;
    private readonly ILogger<ProjectsController> _logger;

    public ProjectsController(IProjectService service, ILogger<ProjectsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    /// <summary>Lista todos los proyectos .scada (sin el contenido completo).</summary>
    [HttpGet]
    [ProducesResponseType<List<ProjectSummary>>(200)]
    public async Task<IActionResult> GetAll([FromQuery] string? deviceId = null)
    {
        _logger.LogInformation("Fetching all projects (deviceId={DeviceId})", deviceId ?? "all");
        var projects = await _service.GetAllAsync(deviceId);
        _logger.LogDebug("Found {ProjectCount} projects", projects.Count);
        return Ok(projects);
    }

    /// <summary>
    /// Descarga el contenido completo de un proyecto .scada.
    /// Retorna el texto plano del archivo.
    /// </summary>
    [HttpGet("{id}")]
    [ProducesResponseType<string>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetContent(int id)
    {
        _logger.LogInformation("Fetching project {ProjectId} content", id);

        var content = await _service.GetContentAsync(id);
        if (content is null)
        {
            _logger.LogWarning("Project {ProjectId} not found", id);
            return NotFound();
        }

        return Content(content, "text/plain; charset=utf-8");
    }

    /// <summary>Obtiene el resumen (metadata) de un proyecto.</summary>
    [HttpGet("{id}/meta")]
    [ProducesResponseType<ProjectSummary>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetMeta(int id)
    {
        _logger.LogInformation("Fetching project {ProjectId} metadata", id);

        var project = await _service.GetMetaAsync(id);
        if (project is null)
        {
            _logger.LogWarning("Project {ProjectId} not found", id);
            return NotFound();
        }

        return Ok(project);
    }

    /// <summary>
    /// Guarda un nuevo proyecto .scada.
    /// El frontend sube el archivo completo como texto plano en el body.
    /// </summary>
    [HttpPost]
    [Consumes("application/json")]
    [ProducesResponseType<ProjectSummary>(201)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Create([FromBody] CreateProjectRequest req)
    {
        _logger.LogInformation("Creating new project: {ProjectName}", req.Name);

        try
        {
            var project = await _service.CreateAsync(req);
            _logger.LogInformation("Project {ProjectId} created successfully", project.Id);
            return CreatedAtAction(nameof(GetMeta), new { id = project.Id }, project);
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Project creation failed: {ProjectName}", req.Name);
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Actualiza nombre, descripción o contenido de un proyecto.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType<ProjectSummary>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateProjectRequest req)
    {
        _logger.LogInformation("Updating project {ProjectId}", id);

        var project = await _service.UpdateAsync(id, req);
        if (project is null)
        {
            _logger.LogWarning("Project {ProjectId} not found for update", id);
            return NotFound();
        }

        _logger.LogInformation("Project {ProjectId} updated successfully", id);
        return Ok(project);
    }

    /// <summary>Elimina un proyecto.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Delete(int id)
    {
        _logger.LogInformation("Deleting project {ProjectId}", id);

        var deleted = await _service.DeleteAsync(id);
        if (!deleted)
        {
            _logger.LogWarning("Project {ProjectId} not found for deletion", id);
            return NotFound();
        }

        _logger.LogInformation("Project {ProjectId} deleted", id);
        return NoContent();
    }

    /// <summary>
    /// Descarga el proyecto como archivo .scada adjunto.
    /// </summary>
    [HttpGet("{id}/download")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Download(int id)
    {
        _logger.LogInformation("Downloading project {ProjectId}", id);

        var project = await _service.GetDownloadAsync(id);
        if (project is null)
        {
            _logger.LogWarning("Project {ProjectId} not found for download", id);
            return NotFound();
        }

        _logger.LogDebug("Downloading project {ProjectId} as {Filename}", id, project.Filename);
        return File(project.Content, "text/plain; charset=utf-8", project.Filename);
    }
}
