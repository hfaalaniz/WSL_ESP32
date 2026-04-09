using ScadaApi.DTOs.Common;

namespace ScadaApi.Middleware;

/// <summary>
/// Middleware centralizado de manejo de excepciones globales.
/// Captura todas las excepciones y retorna un JSON estructurado.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception");
            await HandleExceptionAsync(context, ex);
        }
    }

    private static Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        context.Response.ContentType = "application/json";
        var response = new ApiErrorResponse(
            context.Response.StatusCode,
            exception.Message
        );

        switch (exception)
        {
            case InvalidOperationException:
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                response = new ApiErrorResponse(400, exception.Message, exception.StackTrace);
                break;

            case KeyNotFoundException:
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                response = new ApiErrorResponse(404, "Resource not found", exception.Message);
                break;

            case UnauthorizedAccessException:
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                response = new ApiErrorResponse(401, "Unauthorized", exception.Message);
                break;

            default:
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                response = new ApiErrorResponse(500, "Internal server error", exception.Message);
                break;
        }

        return context.Response.WriteAsJsonAsync(response);
    }
}

/// <summary>Extensión de IApplicationBuilder para registrar el middleware.</summary>
public static class ExceptionHandlingMiddlewareExtensions
{
    public static IApplicationBuilder UseExceptionHandling(this IApplicationBuilder app)
    {
        return app.UseMiddleware<ExceptionHandlingMiddleware>();
    }
}
