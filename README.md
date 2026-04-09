# WSL SCADA - Sistema completo de automatización y monitoreo

![Version](https://img.shields.io/badge/version-1.0.0--alpha-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 📋 Descripción

**WSL SCADA** es un sistema SCADA completo (Supervisory Control And Data Acquisition) basado en **ESP32**, con:

- **Editor visual canvas** (drag & drop) para diseñar interfaces HMI
- **Lenguaje de scripting propio (WSL)** para lógica y automatización
- **Formato de proyecto `.scada`** estandarizado
- **Soporte de expansión I/O** con ICs periódicos (74HC595, 74HC165, ADS1115, MCP23017)
- **API REST** para comunicación HTTP (sin MQTT)
- **Base de datos PostgreSQL** para histórico y alarmas
- **Frontend React** con Konva.js para visualización

## 🎯 Flujo de Desarrollo Integrado

La aplicación frontend integra **5 fases secuenciales** para el desarrollo completo de sistemas SCADA:

### 📋 **Fase 1: Schema** - Estructura del Proyecto
- Define metadatos: nombre, descripción, ID único
- Configuración base del proyecto SCADA
- Preparación para configuración de hardware

### ⚙ **Fase 2: Hardware** - Configuración de Dispositivos
- Configurador visual de pines GPIO ESP32
- Soporte para módulos de expansión I2C
- Generación automática de tags SCADA
- Validación de conflictos de pines

### ⚡ **Fase 3: Firmware** - Generación de Código Arduino
- Generador automático de firmware ESP32
- Soporte completo para todos los módulos configurados
- Código optimizado con handlers HTTP
- Descarga directa de archivos .ino

### 🔧 **Fase 4: Parser WSL** - Scripts de Automatización
- Editor Monaco con sintaxis WSL
- Autocompletado inteligente de tags
- Validación de scripts en tiempo real
- Lógica de control y alarmas

### 🎨 **Fase 5: Editor Canvas** - Diseño Visual SCADA
- Interface drag-and-drop con Konva.js
- Paleta de objetos: sensores, actuadores, indicadores
- Propiedades configurables por objeto
- Múltiples pantallas por proyecto

---

## 🚀 Quick Start

### Requisitos previos

| Componente | Versión | Descripción |
|-----------|---------|-------------|
| **Node.js** | >= 18.0 | Runtime de JavaScript |
| **.NET SDK** | 8.0 | Framework C# |
| **PostgreSQL** | 14+ | Base de datos (opcional, puede usar en-memoria) |
| **Git** | Cualquiera | Control de versiones |

### Instalación (5 minutos)

#### 1. Clonar repositorio
```bash
git clone <repo-url>
cd WSL_ESP32
```

#### 2. Backend (.NET)
```bash
cd backend/ScadaApi

# Restaurar dependencias
dotnet restore

# Ejecutar en desarrollo (usa BD en-memoria)
dotnet run

# Swagger accesible en: http://localhost:5000
```

#### 3. Frontend (React)
```bash
cd frontend

# Instalar dependencias
npm install

# Desarrollo con Vite
npm run dev

# App disponible en: http://localhost:5173
```

---

## 📁 Estructura del Proyecto

```
WSL_ESP32/
├── backend/
│   └── ScadaApi/
│       ├── Controllers/          # Endpoints REST
│       ├── Services/             # Lógica de negocio
│       ├── Models/               # Entidades de base de datos
│       ├── DTOs/                 # Modelos de transferencia
│       ├── Data/                 # DbContext y migraciones
│       ├── Middleware/           # Manejo de excepciones global
│       ├── Validation/           # Validadores
│       ├── Program.cs            # Configuración principal
│       └── appsettings.json      # Configuración
│
├── frontend/
│   └── src/
│       ├── components/           # Componentes React
│       │   ├── ScadaEditor/      # Editor visual canvas
│       │   ├── HardwareConfigurator/
│       │   └── FirmwareGenerator/
│       ├── engine/               # Motor WSL
│       │   ├── TagManager.js
│       │   ├── Transport.js
│       │   ├── WslParser.js
│       │   ├── WslLexer.js
│       │   ├── WslRuntime.js
│       │   └── WslErrors.js
│       ├── services/             # Cliente HTTP
│       │   └── scadaApiClient.js
│       ├── hooks/                # Custom React hooks
│       ├── store/                # Estado global (Zustand)
│       └── utils/                # Utilidades compartidas
│
├── SCADA_CONTEXT.md              # Especificación del proyecto
├── ANALISIS_MEJORAS.md           # Análisis y recomendaciones
└── .env.example                  # Template de variables de entorno
```

---

## 🔌 Configuración de Base de Datos

### Opción 1: En-Memoria (Desarrollo rápido)
```csharp
// No requiere cambios - por defecto usa InMemoryDatabase
```

### Opción 2: PostgreSQL (Producción)
```bash
# 1. Instalar PostgreSQL
# macOS: brew install postgresql
# Windows: https://www.postgresql.org/download/windows/
# Linux: sudo apt-get install postgresql

# 2. Crear base de datos
psql -c "CREATE DATABASE scada_db;"

# 3. Configurar conexión en appsettings.json
```

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "postgresql://user:password@localhost:5432/scada_db"
  }
}
```

```bash
# 4. Ejecutar migraciones
cd backend/ScadaApi
dotnet ef database update
```

---

## 🌍 Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

```bash
cp .env.example .env
```

**Variables principales:**
- `ConnectionStrings__DefaultConnection` → URL de PostgreSQL
- `ASPNETCORE_ENVIRONMENT` → Development | Production
- `CorsOrigins` → URLs permitidas del frontend
- `Logging__LogLevel__Default` → Trace | Debug | Information | Warning

---

## 📡 API REST - Endpoints Principales

### Dispositivos
```
GET    /api/devices                    # Lista todos
GET    /api/devices/{id}               # Obtiene uno
POST   /api/devices                    # Crea nuevo
PUT    /api/devices/{id}               # Actualiza
DELETE /api/devices/{id}               # Elimina
POST   /api/devices/{id}/ping          # Registra presencia
```

### Telemetría
```
GET    /api/devices/{id}/telemetry           # Último valor de todos
POST   /api/devices/{id}/telemetry           # Recibe valores del ESP32
GET    /api/devices/{id}/telemetry/history  # Historial de un tag
DELETE /api/devices/{id}/telemetry/purge    # Limpia registro antiguo
```

### Alarmas
```
GET    /api/devices/{id}/alarms              # Lista alarmas
GET    /api/devices/{id}/alarms/summary      # Resumen por nivel
POST   /api/devices/{id}/alarms              # Crea alarma
PUT    /api/devices/{id}/alarms/{id}/ack     # Confirma (ACK)
PUT    /api/devices/{id}/alarms/ack-all      # Confirma todas
```

### Comandos
```
GET    /api/devices/{id}/commands            # Lista todos los comandos del dispositivo
GET    /api/devices/{id}/commands/pending    # Obtiene comandos pendientes para ESP32
POST   /api/devices/{id}/commands            # Encola un comando nuevo
PUT    /api/devices/{id}/commands/{id}/done  # Marca comando como ejecutado
DELETE /api/devices/{id}/commands/purge      # Elimina comandos ejecutados antiguos
```

### Proyectos
```
GET    /api/projects                         # Lista proyectos (resumen)
GET    /api/projects?deviceId={id}           # Lista proyectos por dispositivo
GET    /api/projects/{id}                    # Descarga el contenido del proyecto
GET    /api/projects/{id}/meta               # Obtiene metadata del proyecto
POST   /api/projects                         # Crea un nuevo proyecto .scada
PUT    /api/projects/{id}                    # Actualiza nombre, descripción o contenido
DELETE /api/projects/{id}                    # Elimina un proyecto
GET    /api/projects/{id}/download           # Descarga el proyecto como archivo .scada
```

## 📖 Documentación de la API

La API incluye documentación completa generada automáticamente con Swagger/OpenAPI.

### Acceso a Swagger UI
- **URL**: `http://localhost:5000` (desarrollo) o `http://localhost:5001` (producción)
- Incluye ejemplos de requests/responses para todos los endpoints
- Documentación XML integrada en los comentarios del código

### Esquemas de Datos

#### Comando (Command)
```json
{
  "id": 123,
  "tag": "esp01.595.out.0",
  "value": true,
  "source": "UI",
  "createdAt": "2024-01-01T10:00:00Z",
  "executedAt": "2024-01-01T10:05:00Z",
  "isExecuted": true
}
```

#### Proyecto (Project)
```json
{
  "id": 42,
  "name": "Sistema de Control Industrial",
  "description": "Monitoreo y control de línea de producción",
  "author": "María García",
  "deviceId": "esp01",
  "contentLength": 1024,
  "createdAt": "2024-01-01T09:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z"
}
```

[📖 Ver documentación completa en Swagger](http://localhost:5000)

---

## 🧪 Testing

### Frontend
```bash
cd frontend
npm run test              # Ejecutar tests
npm run test:ui          # Interfaz de tests
npm run lint             # ESLint
```

### Backend
```bash
cd backend/ScadaApi
dotnet test              # Ejecutar tests
dotnet test --logger console
```

---

## 📚 Documentación

- **[SCADA_CONTEXT.md](./SCADA_CONTEXT.md)** → Especificación técnica completa
- **[ANALISIS_MEJORAS.md](./ANALISIS_MEJORAS.md)** → Análisis arquitectónico
- **[Swagger UI](http://localhost:5000)** → Documentación API interactiva

---

## 🔧 Desarrollo

### Agregar nueva feature

1. **Backend:**
   ```csharp
   // 1. Definir DTOs en /DTOs/*
   // 2. Crear servicio en /Services/*
   // 3. Inyectar en Controller
   // 4. Registrar en Program.cs
   ```

2. **Frontend:**
   ```javascript
   // 1. Crear componente en /components/*
   // 2. Usar ScadaApiClient para requests
   // 3. Integrar en App principal
   ```

### Logs en desarrollo

En PowerShell:
```powershell
cd backend/ScadaApi
dotnet watch run  # Hot reload
```

En otra terminal:
```bash
cd frontend
npm run dev      # Vite hot reload
```

---

## 🚨 Solución de problemas

### "Address already in use"
```bash
# Cambiar puertos en launchSettings.json
# Frontend: Vite usa 5173 por defecto
# Backend: .NET usa 5000/5001
```

### "Database error"
```bash
# Limpiar BD en-memoria
# Reiniciar dotnet run

# PostgreSQL no responde:
pg_isready -h localhost -p 5432
```

### "CORS bloqueado"
1. Verificar `CorsOrigins` en `appsettings.json`
2. Incluir protocolo y puerto: `http://localhost:3000`

---

## 📋 Checklist antes de Producción

- [ ] Cambiar `ASPNETCORE_ENVIRONMENT` a `Production`
- [ ] Configurar `ConnectionStrings__DefaultConnection` real
- [ ] Restringir `CorsOrigins` a dominio específico
- [ ] Habilitar HTTPS
- [ ] Configurar logs a archivo
- [ ] Realizar migraciones de BD
- [ ] Tests pasando (100% cobertura crítica)
- [ ] Documentación actualizada

---

## 🤝 Contribuir

1. Fork del proyecto
2. Crear rama: `git checkout -b feature/nueva-feature`
3. Commit: `git commit -m "feat: descripción"`
4. Push: `git push origin feature/nueva-feature`
5. Pull Request al `main`

---

## 📝 Licencia

MIT License - ver [LICENSE](./LICENSE) para detalles

---

## 👥 Desarrolladores

- **Fabián** (Lead Developer)

---

## 📞 Soporte

Para reportar bugs o sugerencias:
- Crear un [GitHub Issue](https://github.com/tu-repo/issues)
- Contactar al equipo

---

## 🗺️ Roadmap

### v1.1 (Próximo mes)
- [ ] Sistema de usuarios y autenticación
- [ ] Históricos con gráficos avanzados
- [ ] Integración con MQTT
- [ ] App móvil React Native

### v1.5 (Trimestre)
- [ ] Clustering de múltiples ESP32
- [ ] Machine learning para predicción
- [ ] Integración con Azure IoT

### v2.0 (Semestral)
- [ ] Soporte para múltiples MCUs (STM32, PIC)
- [ ] Compilador WSL a C nativo
- [ ] IDE web completo

---

**Versión:** 1.0.0-alpha.1  
**Última actualización:** 8 de abril de 2026  
**Estado:** 🟡 En desarrollo activo
