using System.Text.Json;
using Swashbuckle.AspNetCore.Filters;
using ScadaApi.DTOs.Commands;

namespace ScadaApi.Examples;

public class CreateCommandRequestExample : IExamplesProvider<CreateCommandRequest>
{
    public CreateCommandRequest GetExamples()
    {
        return new CreateCommandRequest(
            Tag: "esp01.595.out.0",
            Value: JsonDocument.Parse("true").RootElement,
            Source: "UI"
        );
    }
}

public class CommandResponseExample : IExamplesProvider<CommandResponse>
{
    public CommandResponse GetExamples()
    {
        return new CommandResponse(
            Id: 123,
            Tag: "esp01.595.out.0",
            Value: true,
            Source: "UI",
            CreatedAt: DateTime.UtcNow.AddMinutes(-5),
            ExecutedAt: DateTime.UtcNow,
            IsExecuted: true
        );
    }
}
