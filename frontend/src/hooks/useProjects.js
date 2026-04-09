import { useScadaStore } from '../store/scadaStore.js';

// Hook para gestión de proyectos
export function useProjects() {
  const {
    projects,
    currentProject,
    saveProject,
    loadProject,
    newProject,
    deleteProject
  } = useScadaStore();

  const exportProject = (projectId) => {
    const project = projects.find(p => p.id === projectId) || currentProject;
    if (!project) return;

    const data = {
      ...project,
      exported: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.scada`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          // Validar estructura básica
          if (!data.id || !data.name) {
            throw new Error('Archivo no válido');
          }
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer archivo'));
      reader.readAsText(file);
    });
  };

  return {
    projects,
    currentProject,
    saveProject,
    loadProject,
    newProject,
    deleteProject,
    exportProject,
    importProject
  };
}

// Hook para navegación entre fases
export function usePhaseNavigation() {
  const { currentPhase, setPhase, nextPhase, prevPhase, canAdvanceToPhase } = useScadaStore();

  return {
    currentPhase,
    setPhase,
    nextPhase,
    prevPhase,
    canAdvanceToPhase
  };
}

// Hook para estado del proyecto
export function useProjectState() {
  const { currentProject, setProject } = useScadaStore();

  return {
    project: currentProject,
    updateProject: setProject
  };
}