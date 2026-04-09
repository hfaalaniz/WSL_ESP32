using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;

namespace ScadaApi.Tests;

/// <summary>
/// Fixture que proporciona un DbContext en memoria para tests.
/// </summary>
public class DbContextFixture : IDisposable
{
    public ScadaDbContext DbContext { get; }

    public DbContextFixture()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: $"ScadaDb_{Guid.NewGuid()}")
            .Options;

        DbContext = new ScadaDbContext(options);
        DbContext.Database.EnsureCreated();
    }

    public void Dispose()
    {
        DbContext.Database.EnsureDeleted();
        DbContext.Dispose();
    }
}

/// <summary>
/// Colección de tests que comparten el mismo DbContext.
/// </summary>
[CollectionDefinition("Database collection")]
public class DatabaseCollection : ICollectionFixture<DbContextFixture>
{
    // Esta clase no tiene cuerpo, solo define la colección de fixtures
}
