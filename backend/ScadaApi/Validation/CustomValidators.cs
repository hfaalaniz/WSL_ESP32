using System.ComponentModel.DataAnnotations;

namespace ScadaApi.Validation;

/// <summary>Validadores personalizados para DTOs.</summary>

[AttributeUsage(AttributeTargets.Property)]
public class ValidDeviceIdAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (value is not string id || string.IsNullOrWhiteSpace(id))
            return new ValidationResult("Device ID es requerido");

        if (id.Length > 64)
            return new ValidationResult("Device ID no puede exceder 64 caracteres");

        if (!System.Text.RegularExpressions.Regex.IsMatch(id, @"^[a-z0-9_-]+$"))
            return new ValidationResult("Device ID solo puede contener minúsculas, números, guiones y guiones bajos");

        return ValidationResult.Success;
    }
}

[AttributeUsage(AttributeTargets.Property)]
public class ValidAlarmLevelAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (value is not string level)
            return new ValidationResult("Level es requerido");

        var validLevels = new[] { "INFO", "WARN", "CRITICAL" };
        if (!validLevels.Contains(level.ToUpper()))
            return new ValidationResult($"Level debe ser uno de: {string.Join(", ", validLevels)}");

        return ValidationResult.Success;
    }
}
