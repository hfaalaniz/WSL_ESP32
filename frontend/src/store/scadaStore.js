import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Estado global de la aplicación SCADA
export const useScadaStore = create(
  persist(
    (set, get) => ({
      // Estado del proyecto actual
      currentProject: {
        id: null,
        name: 'Proyecto SCADA',
        description: '',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        hardware: null, // Configuración de hardware (F2)
        firmware: null, // Código generado (F3)
        screens: [],    // Pantallas del editor (F5)
        script: '',     // Script WSL (F4)
      },

      // Fase actual del flujo de trabajo
      currentPhase: 'F1', // F1, F2, F3, F4, F5

      // Historial de proyectos
      projects: [],

      // Acciones para proyecto actual
      setProject: (project) => set((state) => ({
        currentProject: { ...state.currentProject, ...project, modified: new Date().toISOString() }
      })),

      setHardware: (hardware) => set((state) => ({
        currentProject: { ...state.currentProject, hardware, modified: new Date().toISOString() }
      })),

      setFirmware: (firmware) => set((state) => ({
        currentProject: { ...state.currentProject, firmware, modified: new Date().toISOString() }
      })),

      setScreens: (screens) => set((state) => ({
        currentProject: { ...state.currentProject, screens, modified: new Date().toISOString() }
      })),

      setScript: (script) => set((state) => ({
        currentProject: { ...state.currentProject, script, modified: new Date().toISOString() }
      })),

      // Navegación entre fases
      setPhase: (phase) => set({ currentPhase: phase }),

      nextPhase: () => set((state) => {
        const phases = ['F1', 'F2', 'F3', 'F4', 'F5'];
        const currentIndex = phases.indexOf(state.currentPhase);
        const nextIndex = Math.min(currentIndex + 1, phases.length - 1);
        return { currentPhase: phases[nextIndex] };
      }),

      prevPhase: () => set((state) => {
        const phases = ['F1', 'F2', 'F3', 'F4', 'F5'];
        const currentIndex = phases.indexOf(state.currentPhase);
        const prevIndex = Math.max(currentIndex - 1, 0);
        return { currentPhase: phases[prevIndex] };
      }),

      // Gestión de proyectos
      saveProject: () => set((state) => {
        const project = {
          ...state.currentProject,
          id: state.currentProject.id || `project-${Date.now()}`,
          modified: new Date().toISOString(),
        };
        const existingIndex = state.projects.findIndex(p => p.id === project.id);
        const newProjects = [...state.projects];

        if (existingIndex >= 0) {
          newProjects[existingIndex] = project;
        } else {
          newProjects.push(project);
        }

        return { projects: newProjects, currentProject: project };
      }),

      loadProject: (projectId) => set((state) => {
        const project = state.projects.find(p => p.id === projectId);
        if (project) {
          return { currentProject: project };
        }
        return state;
      }),

      newProject: () => set({
        currentProject: {
          id: null,
          name: 'Nuevo Proyecto SCADA',
          description: '',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          hardware: null,
          firmware: null,
          screens: [],
          script: '',
        },
        currentPhase: 'F1'
      }),

      deleteProject: (projectId) => set((state) => ({
        projects: state.projects.filter(p => p.id !== projectId)
      })),

      // Utilidades
      canAdvanceToPhase: (targetPhase) => {
        const state = get();
        switch (targetPhase) {
          case 'F2': return true;
          case 'F3': return !!state.currentProject.hardware;
          case 'F4': return !!state.currentProject.firmware;
          case 'F5': return !!state.currentProject.hardware;
          case 'F6': return !!state.currentProject.hardware;
          default: return true;
        }
      },

      getPhaseStatus: () => {
        const state = get();
        return {
          F1: true,
          F2: !!state.currentProject.hardware,
          F3: !!state.currentProject.firmware,
          F4: state.currentProject.screens?.length > 0,
          F5: !!state.currentProject.script?.trim(),
          F6: !!state.currentProject.hardware,
        };
      }
    }),
    {
      name: 'wsl-scada-storage-v2',
      partialize: (state) => ({
        currentProject: state.currentProject,
        currentPhase: state.currentPhase,
        projects: state.projects
      })
    }
  )
);